/* obj-symbols.mjs - name a frame that pdb-symbols.mjs names WRONGLY.
 *
 * pdb-symbols.mjs's header states the PDB "carries publics AND per-module
 * S_LPROC32 records, so even a `static` function in the EMITTED PROGRAM TU
 * resolves, with its code size". ***That is false on the LLVM lane.*** The
 * emitted module has no debug stream at all -- llvm-pdbutil answers "Module
 * stream not present" -- and ONE of the program's 27,281 `define`s, `main`,
 * reaches Publics. sqlite3.o is the same story from the other direction: 277
 * of its 2,363 functions are exported and the rest are `static`.
 *
 * Resolving against Publics alone therefore does not return "unknown" for
 * those frames. It returns the nearest preceding EXPORTED symbol, which for a
 * frame inside the emitted program is a name out of some other object
 * entirely -- `sqlite3_sourceid+504774`. A wrong name wearing a right name's
 * shape, and it is what a size-banded stack census reads as its answer.
 *
 * WHAT WORKS. `nsyms=0` is true of the linked PE and false of the OBJECTS the
 * linker consumed: zig keeps them in its cache and in vendor/.cache, and a
 * COFF object carries a full symbol table including every `static` function
 * with its offset inside that object's .text. The PDB's section-contribs says
 * where each module's .text landed. RVA = contribution base + symbol value.
 *
 * A ROUTE THAT WAS TRIED AND IS REFUSED, because the refusal is the point:
 * index-aligning the PE's .pdata against the .ll's `define` order looks
 * equivalent and is not -- 24,220 unwind records against 27,281 defines,
 * because an x64 leaf function that touches no callee-saved register and
 * allocates no frame carries no unwind record at all. A map built on it would
 * have named most frames wrongly rather than failing. Every map below is
 * CHECKED against the publics that do fall inside its own range and is
 * refused if they disagree.
 *
 *   node tests/perf/obj-symbols.mjs --exe E --pdb P --obj zapo-rest.obj
 *   node tests/perf/obj-symbols.mjs --exe E --pdb P --obj sqlite3.o --mod sqlite3
 */
import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BS = String.fromCharCode(92)
const LOADER = '/opt/hslib/usr/lib/ld-linux-x86-64.so.2'
const LIBPATH = '/opt/hslib/usr/lib:/usr/lib'

export function toWsl(p) {
  const m = /^([A-Za-z]):[/\\](.*)$/.exec(p)
  const rest = m ? m[2] : p
  const fwd = rest.split(BS).join('/')
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + fwd : fwd
}

export function pdbutil(pdb, args) {
  const out = execFileSync('wsl.exe',
    ['-e', LOADER, '--library-path', LIBPATH, '/usr/bin/llvm-pdbutil',
     'dump', ...args, toWsl(pdb)],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })
  return out.split('\0').join('')
}

/* ---- PE: section headers and the .pdata function table ---------------- */
export function peFunctions(exePath) {
  const b = readFileSync(exePath)
  const peOff = b.readUInt32LE(0x3c)
  if (b.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE')
  const nSec = b.readUInt16LE(peOff + 6)
  const optSize = b.readUInt16LE(peOff + 20)
  const secOff = peOff + 24 + optSize
  const sections = []
  for (let i = 0; i < nSec; i++) {
    const o = secOff + i * 40
    sections.push({
      name: b.toString('latin1', o, o + 8).replace(/\u0000+$/, ''),
      vsize: b.readUInt32LE(o + 8),
      rva: b.readUInt32LE(o + 12),
      rawSize: b.readUInt32LE(o + 16),
      rawPtr: b.readUInt32LE(o + 20),
    })
  }
  const pd = sections.find(s => s.name === '.pdata')
  if (!pd) throw new Error('no .pdata section')
  const n = Math.floor(Math.min(pd.rawSize, pd.vsize) / 12)
  const fns = []
  for (let i = 0; i < n; i++) {
    const o = pd.rawPtr + i * 12
    const beg = b.readUInt32LE(o)
    const end = b.readUInt32LE(o + 4)
    if (beg === 0 && end === 0) continue
    fns.push({ beg, end })
  }
  fns.sort((a, c) => a.beg - c.beg)
  return { sections, fns }
}

/* ---- the emitted module's .text range, from the PDB ------------------- */
export function emittedRange(pdb, sections) {
  const mods = pdbutil(pdb, ['--modules'])
  let modi = -1
  let modName = ''
  for (const line of mods.split(/\r?\n/)) {
    const m = /^\s*Mod (\d+) \| `([^`]+)`/.exec(line)
    if (m && /zapo-rest/i.test(m[2])) { modi = Number(m[1]); modName = m[2]; break }
  }
  if (modi < 0) throw new Error('emitted module not found in PDB module list')
  const sc = pdbutil(pdb, ['--section-contribs'])
  let best = null
  for (const line of sc.split(/\r?\n/)) {
    const m = /^\s*SC\[\.text\]\s*\|\s*mod = (\d+), (\d+):(\d+), size = (\d+)/.exec(line)
    if (!m || Number(m[1]) !== modi) continue
    const sec = sections[Number(m[2]) - 1]
    const lo = sec.rva + Number(m[3])
    const size = Number(m[4])
    if (!best || size > best.size) best = { modi, modName, lo, size, hi: lo + size }
  }
  if (!best) throw new Error('no .text contribution for mod ' + modi)
  return best
}

export function llDefines(llPath) {
  const txt = readFileSync(llPath, 'latin1')
  const out = []
  const re = /^define[^\n@]*@([A-Za-z0-9_$.]+|"(?:[^"]*)")/gm
  let m
  while ((m = re.exec(txt)) !== null) {
    let n = m[1]
    if (n.charCodeAt(0) === 34) n = n.slice(1, -1)
    out.push(n)
  }
  return out
}

/* llvm-pdbutil prints a public over TWO lines -- the name on the record line
 * and `addr = <section>:<offset>` in DECIMAL on the next. A one-line regex
 * over it matched nothing and the anchor check then silently did not run,
 * which is the failure mode this whole file was written to avoid. */
export function publics(pdb) {
  const txt = pdbutil(pdb, ['--publics'])
  const map = new Map()
  let pending = null
  for (const line of txt.split(/\r?\n/)) {
    const n = /S_PUB32 \[size = \d+\] `([^`]+)`/.exec(line)
    if (n) { pending = n[1]; continue }
    const a = /addr = (\d+):(\d+)/.exec(line)
    if (a && pending !== null) {
      map.set(pending, { sec: Number(a[1]), off: Number(a[2]) })
      pending = null
    }
  }
  return map
}

export function buildMap(opts) {
  const { sections, fns } = peFunctions(opts.exe)
  const range = emittedRange(opts.pdb, sections)
  const inRange = fns.filter(f => f.beg >= range.lo && f.beg < range.hi)
  const defs = llDefines(opts.ll)
  const checks = []
  checks.push(['pdata entries inside emitted .text', inRange.length])
  checks.push(['define lines in .ll', defs.length])
  const countsEqual = inRange.length === defs.length
  checks.push(['COUNTS EQUAL', countsEqual])
  let anchorOk = null
  const pubs = publics(opts.pdb)
  const mainSym = pubs.get('main')
  if (mainSym) {
    const mainRva = sections[mainSym.sec - 1].rva + mainSym.off
    const idxByAddr = inRange.findIndex(f => f.beg === mainRva)
    const idxByDef = defs.indexOf('main')
    checks.push(['main rva', '0x' + mainRva.toString(16)])
    checks.push(['main index by address', idxByAddr])
    checks.push(['main index by .ll order', idxByDef])
    anchorOk = idxByAddr >= 0 && idxByAddr === idxByDef
    checks.push(['ANCHOR AGREES', anchorOk])
  }
  const ok = countsEqual && anchorOk === true
  return { range, inRange, defs, checks, ok, sections, fns }
}

export function makeResolver(map) {
  const { inRange, defs, fns } = map
  return function resolve(rva) {
    if (rva >= map.range.lo && rva < map.range.hi) {
      let lo = 0, hi = inRange.length - 1, found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (inRange[mid].beg <= rva) { found = mid; lo = mid + 1 } else hi = mid - 1
      }
      if (found >= 0 && rva < inRange[found].end) {
        return { name: defs[found], off: rva - inRange[found].beg, kind: 'emitted' }
      }
      return { name: '<emitted:unmapped>', off: 0, kind: 'emitted?' }
    }
    let lo = 0, hi = fns.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (fns[mid].beg <= rva) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return { name: null, off: 0, kind: 'outside', beg: found >= 0 ? fns[found].beg : 0 }
  }
}

const IMAGE_SYM_CLASS_EXTERNAL = 2
const IMAGE_SYM_CLASS_STATIC = 3
const IMAGE_SYM_DTYPE_FUNCTION = 2

export function coffSymbols(objPath) {
  const b = readFileSync(objPath)
  /* COFF header: machine(2) nsec(2) time(4) symptr(4) nsyms(4) optsz(2) chr(2) */
  const nSec = b.readUInt16LE(2)
  const symPtr = b.readUInt32LE(8)
  const nSyms = b.readUInt32LE(12)
  const optSize = b.readUInt16LE(16)
  const secOff = 20 + optSize
  const sections = []
  for (let i = 0; i < nSec; i++) {
    const o = secOff + i * 40
    sections.push({
      index: i + 1,
      rawName: b.toString('latin1', o, o + 8).replace(/\0+$/, ''),
      size: b.readUInt32LE(o + 16),
    })
  }
  const strTabOff = symPtr + nSyms * 18
  const strTabLen = b.readUInt32LE(strTabOff)
  const str = off => {
    let e = strTabOff + off
    while (e < strTabOff + strTabLen && b[e] !== 0) e++
    return b.toString('latin1', strTabOff + off, e)
  }
  const syms = []
  for (let i = 0; i < nSyms; i++) {
    const o = symPtr + i * 18
    const z = b.readUInt32LE(o)
    let name
    if (z === 0) name = str(b.readUInt32LE(o + 4))
    else name = b.toString('latin1', o, o + 8).replace(/\0+$/, '')
    const value = b.readUInt32LE(o + 8)
    const secNum = b.readInt16LE(o + 12)
    const type = b.readUInt16LE(o + 14)
    const cls = b.readUInt8(o + 16)
    const aux = b.readUInt8(o + 17)
    syms.push({ name, value, secNum, type, cls })
    i += aux
  }
  return { sections, syms }
}

export function buildObjMap(opts) {
  const { sections: peSecs } = peFunctions(opts.exe)
  const range = emittedRange(opts.pdb, peSecs)
  const { sections: objSecs, syms } = coffSymbols(opts.obj)
  /* The object's code section. The contribution the PDB reports is ONE
   * range, so there must be exactly one .text of that size. */
  const text = objSecs.filter(s => s.rawName === '.text')
  const match = text.filter(s => s.size === range.size)
  const fnSyms = syms.filter(s =>
    s.secNum > 0 &&
    (s.cls === IMAGE_SYM_CLASS_EXTERNAL || s.cls === IMAGE_SYM_CLASS_STATIC) &&
    ((s.type >> 4) & 0xf) === IMAGE_SYM_DTYPE_FUNCTION &&
    objSecs[s.secNum - 1] && objSecs[s.secNum - 1].rawName === '.text')
  const seen = new Map()
  for (const s of fnSyms) {
    const rva = range.lo + s.value
    if (!seen.has(rva)) seen.set(rva, s.name)
  }
  const table = [...seen.entries()].map(([rva, name]) => ({ rva, name }))
  table.sort((a, c) => a.rva - c.rva)

  const checks = []
  checks.push(['obj', opts.obj + ' (' + statSync(opts.obj).size + ' B)'])
  checks.push(['emitted .text contribution size', range.size])
  checks.push(['object .text sections', text.length + ' (size match: ' + match.length + ')'])
  checks.push(['COFF symbols', syms.length])
  checks.push(['function symbols in .text', fnSyms.length])
  checks.push(['distinct RVAs', table.length])
  const pubs = publics(opts.pdb)
  const mainSym = pubs.get('main')
  let anchorOk = null
  if (mainSym) {
    const mainRvaPub = peSecs[mainSym.sec - 1].rva + mainSym.off
    const mine = table.find(t => t.name === 'main')
    checks.push(['main rva from Publics', '0x' + mainRvaPub.toString(16)])
    checks.push(['main rva from obj map', mine ? '0x' + mine.rva.toString(16) : '(absent)'])
    anchorOk = !!mine && mine.rva === mainRvaPub
    checks.push(['ANCHOR AGREES', anchorOk])
  }
  const ok = text.length >= 1 && match.length === 1 && anchorOk === true
  return { range, table, checks, ok }
}

export function makeObjResolver(map, pdbSyms) {
  const t = map.table
  return function resolve(rva) {
    if (rva >= map.range.lo && rva < map.range.hi) {
      let lo = 0, hi = t.length - 1, found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (t[mid].rva <= rva) { found = mid; lo = mid + 1 } else hi = mid - 1
      }
      if (found < 0) return { name: '<emitted:before first symbol>', off: 0, kind: 'emitted' }
      return { name: t[found].name, off: rva - t[found].rva, kind: 'emitted' }
    }
    if (!pdbSyms) return { name: '<outside emitted module>', off: 0, kind: 'other' }
    let lo = 0, hi = pdbSyms.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (pdbSyms[mid].rva <= rva) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    if (found < 0) return { name: '<unknown>', off: 0, kind: 'other' }
    return { name: pdbSyms[found].name, off: rva - pdbSyms[found].rva, kind: 'runtime' }
  }
}

export function buildModMap(opts) {
  const { sections: peSecs } = peFunctions(opts.exe)
  const mods = pdbutil(opts.pdb, ['--modules'])
  const want = new RegExp(opts.mod, 'i')
  let modi = -1, modName = ''
  for (const line of mods.split(/\r?\n/)) {
    const m = /^\s*Mod (\d+) \| `([^`]+)`/.exec(line)
    if (m && want.test(m[2])) { modi = Number(m[1]); modName = m[2]; break }
  }
  if (modi < 0) throw new Error('module not found: ' + opts.mod)
  const sc = pdbutil(opts.pdb, ['--section-contribs'])
  let best = null
  for (const line of sc.split(/\r?\n/)) {
    const m = /^\s*SC\[\.text\]\s*\|\s*mod = (\d+), (\d+):(\d+), size = (\d+)/.exec(line)
    if (!m || Number(m[1]) !== modi) continue
    const sec = peSecs[Number(m[2]) - 1]
    const lo = sec.rva + Number(m[3]), size = Number(m[4])
    if (!best || size > best.size) best = { modi, modName, lo, size, hi: lo + size }
  }
  if (!best) throw new Error('no .text contribution for mod ' + modi)

  const { sections: objSecs, syms } = coffSymbols(opts.obj)
  const text = objSecs.filter(s => s.rawName === '.text')
  const sizeMatch = text.filter(s => s.size === best.size)
  const fnSyms = syms.filter(s =>
    s.secNum > 0 && (s.cls === 2 || s.cls === 3) && ((s.type >> 4) & 0xf) === 2 &&
    objSecs[s.secNum - 1] && objSecs[s.secNum - 1].rawName === '.text')
  const seen = new Map()
  for (const s of fnSyms) { const rva = best.lo + s.value; if (!seen.has(rva)) seen.set(rva, s.name) }
  const table = [...seen.entries()].map(([rva, name]) => ({ rva, name })).sort((a, c) => a.rva - c.rva)

  /* Cross-check EVERY public that falls inside this module's range. */
  const pubs = publics(opts.pdb)
  let checked = 0, agree = 0
  const byName = new Map(table.map(t => [t.name, t.rva]))
  for (const [name, loc] of pubs) {
    const rva = peSecs[loc.sec - 1].rva + loc.off
    if (rva < best.lo || rva >= best.hi) continue
    checked++
    if (byName.get(name) === rva) agree++
  }
  const checks = [
    ['module', modName],
    ['.text rva', '0x' + best.lo.toString(16) + '..0x' + best.hi.toString(16) + ' size=' + best.size],
    ['object .text sections', text.length + ' (size match ' + sizeMatch.length + ')'],
    ['function symbols', table.length],
    ['publics inside range', checked],
    ['publics AGREEING', agree],
  ]
  const ok = sizeMatch.length === 1 && checked > 0 && agree === checked
  return { range: best, table, checks, ok }
}

export function resolverFor(maps, fallback) {
  return function resolve(rva) {
    for (const m of maps) {
      if (rva >= m.range.lo && rva < m.range.hi) {
        const t = m.table
        let lo = 0, hi = t.length - 1, f = -1
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid].rva <= rva) { f = mid; lo = mid + 1 } else hi = mid - 1 }
        return f < 0 ? { name: '<' + m.kind + ':?>', off: 0, kind: m.kind }
                     : { name: t[f].name, off: rva - t[f].rva, kind: m.kind }
      }
    }
    return fallback(rva)
  }
}


if (process.argv[1] && process.argv[1].split(BS).join('/').endsWith('obj-symbols.mjs')) {
  const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null }
  const o = { exe: arg('exe'), pdb: arg('pdb'), obj: arg('obj'), mod: arg('mod') }
  const r = o.mod ? buildModMap(o) : buildObjMap(o)
  for (const [k, v] of r.checks) console.log('  ' + k + ': ' + v)
  console.log('VERDICT: ' + (r.ok ? 'MAP USABLE' : 'MAP REFUSED'))
}
