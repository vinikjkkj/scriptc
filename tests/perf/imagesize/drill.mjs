/**
 * drill.mjs - break ONE PDB module down by symbol, and roll the symbols up
 * by the scriptc mangling scheme.
 *
 * The emitted program is a single translation unit, so the module-level
 * attribution in attrib.mjs bottoms out at "the program". This goes inside
 * it, using the PDB's per-module S_LPROC32/S_GPROC32 records, each of which
 * carries an exact `code size`. Those are what the PE actually contains -
 * a function that the C emitter wrote but the optimiser deleted has NO
 * record, so this counts SHIPPED bytes, not emitted source.
 *
 * The roll-up keys come from packages/compiler/src/backend/mangle.ts:
 *
 *   sc_f_   user function        sc_w_   closure wrapper for one
 *   sc_c_   ...                  sc_vt_  vtable adapter
 *   and the lowerer tags every non-entry module with `%m<i>.`, which
 *   sanitize() encodes as `_x25_m<i>_`. So `sc_f__x25_m109_...` is module
 *   109 and `sc_f__x25__x25_m109_Cls_meth` is a method on a class in it.
 *
 * Usage:
 *   node drill.mjs --pdb x.pdb --module rtmax3.obj [--top 40] [--json out]
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { pdbutil, pdbModules } from './attrib.mjs'

const NL = /\r?\n/

/** Every symbol in one module that carries a code size. */
export function moduleSymbols(pdb, modi) {
  const text = pdbutil(pdb, ['--symbols', '--modi=' + modi])
  const out = []
  let name = null
  for (const line of text.split(NL)) {
    let m = /\|\s*(S_LPROC32|S_GPROC32|S_LPROC32_ID|S_GPROC32_ID)\s*\[size = \d+\]\s*`(.*)`\s*$/.exec(line)
    if (m) { name = m[2]; continue }
    if (name === null) continue
    m = /code size = (\d+)/.exec(line)
    if (m) { out.push({ name, size: Number(m[1]) }); name = null; continue }
    if (/addr = /.test(line)) { name = null }
  }
  return out
}

/** Static data objects (S_LDATA32/S_GDATA32) have no size in the symbol
 *  record; their bytes are visible only as section contributions, which
 *  attrib.mjs already totals. Reported here as a COUNT so the difference
 *  between the symbol total and the module's .text contribution is
 *  explainable rather than mysterious. */
export function moduleDataCount(pdb, modi) {
  const text = pdbutil(pdb, ['--symbols', '--modi=' + modi])
  let n = 0
  for (const line of text.split(NL)) if (/\|\s*S_[LG]DATA32\s/.test(line)) n++
  return n
}

const MOD_TAG = /_x25_m(\d+)_/

export function bucketOf(name) {
  const mm = MOD_TAG.exec(name)
  const mod = mm ? Number(mm[1]) : -1          // -1 = the entry module
  let kind = 'other'
  if (/^sc_f_/.test(name)) kind = 'fn'
  else if (/^sc_w_/.test(name)) kind = 'wrapper'
  else if (/^sc_vt_|^sc_va_/.test(name)) kind = 'vtadapter'
  else if (/^sc_thunk_|_thunk$/.test(name)) kind = 'thunk'
  else if (/^sc_/.test(name)) kind = 'sc-other'
  else if (/^scr_/.test(name)) kind = 'runtime-inline'
  // class methods carry a doubled tag: sc_f__x25__x25_m109_Cls_meth
  const isMethod = /_x25__x25_m\d+_/.test(name)
  return { mod, kind, isMethod }
}

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
  const pdb = flag('pdb')
  const want = flag('module', 'rtmax3.obj')
  const top = Number(flag('top', '40'))
  if (!pdb) { console.error('usage: --pdb <file.pdb> [--module rtmax3.obj]'); process.exit(2) }

  const mods = pdbModules(pdb)
  let modi = -1
  for (const [i, p] of mods) if (p.endsWith(want)) { modi = i; break }
  if (modi < 0) { console.error('no module ending in ' + want); process.exit(3) }
  console.log('module ' + modi + ' = ' + mods.get(modi))

  const syms = moduleSymbols(pdb, modi)
  const total = syms.reduce((a, s) => a + s.size, 0)
  console.log('procedures ' + fmt(syms.length) + '   code bytes ' + fmt(total) +
    '  (' + (total / 1048576).toFixed(2) + ' MiB)   mean ' + Math.round(total / syms.length))
  console.log('')

  const byKind = new Map()
  const byMod = new Map()
  for (const s of syms) {
    const b = bucketOf(s.name)
    const k = b.kind + (b.isMethod ? '/method' : '')
    let e = byKind.get(k); if (!e) { e = { n: 0, bytes: 0 }; byKind.set(k, e) }
    e.n++; e.bytes += s.size
    let m = byMod.get(b.mod); if (!m) { m = { n: 0, bytes: 0 }; byMod.set(b.mod, m) }
    m.n++; m.bytes += s.size
  }

  console.log('== BY MANGLING KIND ==')
  console.log('  kind                 count        bytes       MiB      mean')
  for (const [k, v] of [...byKind].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log('  ' + k.padEnd(18) + fmt(v.n).padStart(8) + fmt(v.bytes).padStart(13) +
      (v.bytes / 1048576).toFixed(2).padStart(10) + fmt(Math.round(v.bytes / v.n)).padStart(10))
  }
  console.log('')
  console.log('== TOP ' + top + ' MODULES (by %m<i> tag) ==')
  console.log('  module     count        bytes       MiB      mean')
  const modsSorted = [...byMod].sort((a, b) => b[1].bytes - a[1].bytes)
  for (const [k, v] of modsSorted.slice(0, top)) {
    console.log('  ' + ('m' + k).padEnd(9) + fmt(v.n).padStart(8) + fmt(v.bytes).padStart(13) +
      (v.bytes / 1048576).toFixed(2).padStart(10) + fmt(Math.round(v.bytes / v.n)).padStart(10))
  }
  console.log('  (' + modsSorted.length + ' distinct module tags in all)')
  console.log('')
  console.log('== TOP ' + top + ' PROCEDURES ==')
  for (const s of [...syms].sort((a, b) => b.size - a.size).slice(0, top)) {
    console.log('  ' + fmt(s.size).padStart(10) + '  ' + s.name)
  }

  const jsonOut = flag('json')
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ pdb, modi, module: mods.get(modi), total, syms }, null, 0), 'utf8')
    console.log('\n-> ' + jsonOut)
  }
}
