/**
 * attrib.mjs - attribute a scriptc-built Windows PE by CAUSE.
 *
 * Two independent instruments, cross-checked against each other:
 *
 *   1. The PE section table, read from the file (never computed): every
 *      section's VirtualSize, SizeOfRawData and file offset. Sum of raw
 *      sizes + headers = the file size, exactly. This is the TOP LINE and
 *      nothing may contradict it.
 *
 *   2. The PDB's SECTION CONTRIBUTIONS: one record per (module, section,
 *      offset) with an exact byte size. `llvm-pdbutil dump
 *      --section-contribs` emits them; the module index resolves through
 *      `--modules` to an object file path, and the object path is the
 *      SOURCE FILE. Rolling contributions up by module gives per-.c bytes;
 *      rolling modules up by their directory gives per-subsystem bytes.
 *
 * The two instruments disagree by construction on exactly one thing: the
 * linker's own synthesised content (import tables, the PE header, thunks,
 * padding between contributions). That residue is REPORTED as
 * "unattributed", never silently absorbed - if it grows, the attribution
 * has stopped explaining the binary.
 *
 * Usage:
 *   node attrib.mjs --exe <build>.exe [--pdb <build>.pdb] [--json out.json]
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const NL = /\r?\n/
const LOADER = '/opt/hslib/usr/lib/ld-linux-x86-64.so.2'
const LIBPATH = '/opt/hslib/usr/lib:/usr/lib'

export function toWslPath(p) {
  const BS = String.fromCharCode(92)
  const m = /^([A-Za-z]):[/\\](.*)$/.exec(p)
  if (!m) return p.split(BS).join('/')
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].split(BS).join('/')
}

export function pdbutil(pdbWinPath, args) {
  const res = spawnSync('wsl.exe',
    ['-e', LOADER, '--library-path', LIBPATH, '/usr/bin/llvm-pdbutil',
      'dump', ...args, toWslPath(pdbWinPath)],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })
  if (res.status !== 0) throw new Error('llvm-pdbutil failed (' + res.status + '): ' + String(res.stderr ?? '').slice(0, 400))
  return String(res.stdout ?? '').replace(/\0/g, '')
}

/* ---- instrument 1: the PE section table, read from the FILE ---------- */

export function peSections(exePath) {
  const buf = readFileSync(exePath)
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE (no MZ)')
  const peOff = buf.readUInt32LE(0x3c)
  if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE signature')
  const coff = peOff + 4
  const nSections = buf.readUInt16LE(coff + 2)
  const optSize = buf.readUInt16LE(coff + 16)
  const opt = coff + 20
  const magic = buf.readUInt16LE(opt)
  const plus = magic === 0x20b
  const sizeOfImage = buf.readUInt32LE(opt + 56)
  const sizeOfHeaders = buf.readUInt32LE(opt + 60)
  const fileAlign = buf.readUInt32LE(opt + 36)
  const sectAlign = buf.readUInt32LE(opt + 32)
  const ddOff = opt + (plus ? 112 : 96)
  const nDD = buf.readUInt32LE(opt + (plus ? 108 : 92))
  const DD_NAMES = ['export', 'import', 'resource', 'exception', 'security', 'basereloc',
    'debug', 'architecture', 'globalptr', 'tls', 'load_config', 'bound_import',
    'iat', 'delay_import', 'com_descriptor', 'reserved']
  const dirs = []
  for (let i = 0; i < Math.min(nDD, 16); i++) {
    const rva = buf.readUInt32LE(ddOff + i * 8)
    const size = buf.readUInt32LE(ddOff + i * 8 + 4)
    if (rva || size) dirs.push({ name: DD_NAMES[i], rva, size })
  }
  const secOff = opt + optSize
  const sections = []
  for (let i = 0; i < nSections; i++) {
    const o = secOff + i * 40
    const name = buf.toString('utf8', o, o + 8).replace(/\0+$/, '')
    sections.push({
      index: i + 1,
      name,
      vsize: buf.readUInt32LE(o + 8),
      rva: buf.readUInt32LE(o + 12),
      rawSize: buf.readUInt32LE(o + 16),
      rawPtr: buf.readUInt32LE(o + 20),
      chars: buf.readUInt32LE(o + 36),
    })
  }
  return {
    fileSize: statSync(exePath).size,
    sizeOfImage, sizeOfHeaders, fileAlign, sectAlign, dirs, sections,
  }
}

/* ---- instrument 2: PDB modules + section contributions --------------- */

export function pdbModules(pdb) {
  const text = pdbutil(pdb, ['--modules'])
  const mods = new Map()
  for (const line of text.split(NL)) {
    const m = /^\s*Mod (\d+) \| `(.*)`:\s*$/.exec(line)
    if (m) mods.set(Number(m[1]), m[2])
  }
  return mods
}

export function pdbContribs(pdb) {
  const text = pdbutil(pdb, ['--section-contribs'])
  const out = []
  for (const line of text.split(NL)) {
    const m = /^\s*SC\[([^\]]*)\]\s*\|\s*mod = (\d+), ([0-9A-Fa-f]{4}):(\d+), size = (\d+)/.exec(line)
    if (m) out.push({ section: m[1], mod: Number(m[2]), sec: Number.parseInt(m[3], 10), off: Number(m[4]), size: Number(m[5]) })
  }
  return out
}

/* ---- bucketing: object path -> source file -> subsystem -------------- */

const BS = String.fromCharCode(92)

/* The observed module shapes in a scriptc PE's PDB, and the ONE rule that
 * names each. Every rule is anchored on something structural (a path
 * marker or a linker-synthesised prefix), never on a guessed file list:
 *
 *   `* Linker *`                       the linker's own records
 *   `Import:foo.dll` / `FOO.dll`       import thunks and the IAT
 *   ...\zig-global\o\<hash>\x.obj      mingw CRT, ucrt shims, compiler_rt
 *   ...\<zig local>\o\<hash>\scr_*.obj the scriptc runtime
 *   ...\<zig local>\o\<hash>\monocy*   monocypher, vendored by the runtime
 *   ...\<zig local>\o\<hash>\<other>   THE EMITTED PROGRAM (one TU)
 *   ...vendor\.cache\zlib-*\x.o        zlib
 *   ...vendor\.cache\*-lre-*\x.o       libregexp + libunicode
 *   ...vendor\.cache\*quickjs*\x.o     the embedded engine (never in a
 *                                      static build; present for --dynamic)
 *   <bare>.o with NO directory         mbedTLS, linked from its archive,
 *                                      whose PDB records carry only the
 *                                      archive member name
 *
 * A module that matches none of these is bucketed `unclassified` and
 * PRINTED, so a new vendor library cannot quietly land in `other`. */
export function classify(objPath) {
  const p = objPath.split(BS).join('/')
  const slash = p.lastIndexOf('/')
  const base = slash < 0 ? p : p.slice(slash + 1)
  const dir = slash < 0 ? '' : p.slice(0, slash)
  const dirBase = dir.slice(dir.lastIndexOf('/') + 1)
  let subsystem
  if (p === '* Linker *') subsystem = 'linker'
  else if (/^Import:/.test(p) || /\.dll$/i.test(p)) subsystem = 'import'
  else if (/zig-global/.test(dir)) subsystem = 'crt'
  else if (/^scr_[a-z0-9_]+\.(obj|o)$/.test(base)) subsystem = 'runtime'
  else if (/^monocypher/.test(base)) subsystem = 'monocypher'
  else if (/^(libregexp|libunicode)\.(o|obj)$/.test(base)) subsystem = 'libregexp'
  else if (/zlib-/.test(dirBase)) subsystem = 'zlib'
  else if (/quickjs|^dtoa\.(o|obj)$|^cutils\./.test(base)) subsystem = 'quickjs'
  else if (dir === '' && /\.(o|obj)$/.test(base)) subsystem = 'mbedtls'
  else subsystem = 'unclassified'
  return { subsystem, file: base, dir, base }
}

/** The emitted program TU has a build-specific object name (`<entry>.obj`);
 *  it is identified STRUCTURALLY, as the module sharing the zig local cache
 *  with the scr_*.obj runtime units but not being one of them. */
export function makeClassifier(mods) {
  const localCacheRoots = new Set()
  for (const p of mods.values()) {
    const s = p.split(BS).join('/')
    const base = s.slice(s.lastIndexOf('/') + 1)
    if (/^scr_[a-z0-9_]+\.(obj|o)$/.test(base)) {
      // .../<root>/o/<hash>/scr_x.obj -> <root>/o
      const dir = s.slice(0, s.lastIndexOf('/'))
      localCacheRoots.add(dir.slice(0, dir.lastIndexOf('/')))
    }
  }
  return (objPath) => {
    const c = classify(objPath)
    if (c.subsystem === 'unclassified') {
      const s = objPath.split(BS).join('/')
      const dir = s.slice(0, s.lastIndexOf('/'))
      const root = dir.slice(0, dir.lastIndexOf('/'))
      if (localCacheRoots.has(root)) c.subsystem = 'program'
    }
    return c
  }
}

/* ---- the roll-up ------------------------------------------------------ */

export function attribute(exePath, pdbPath) {
  const pe = peSections(exePath)
  const mods = pdbModules(pdbPath)
  const contribs = pdbContribs(pdbPath)
  const classifyOne = makeClassifier(mods)

  const secByIndex = new Map(pe.sections.map((s) => [s.index, s]))
  const bySubsystem = new Map()
  const byFile = new Map()
  const bySection = new Map()
  let attributed = 0
  const unknownMods = new Set()

  for (const c of contribs) {
    const obj = mods.get(c.mod)
    if (obj === undefined) { unknownMods.add(c.mod); continue }
    const k = classifyOne(obj)
    const sec = secByIndex.get(c.sec)
    const secName = sec ? sec.name : c.section
    attributed += c.size
    const add = (map, key) => {
      let e = map.get(key)
      if (!e) { e = { total: 0, sections: new Map(), n: 0 }; map.set(key, e) }
      e.total += c.size; e.n++
      e.sections.set(secName, (e.sections.get(secName) ?? 0) + c.size)
    }
    add(bySubsystem, k.subsystem)
    add(byFile, k.subsystem + '/' + k.file)
    bySection.set(secName, (bySection.get(secName) ?? 0) + c.size)
  }

  return { pe, mods, contribs, bySubsystem, byFile, bySection, attributed, unknownMods }
}

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
  const exe = flag('exe')
  if (!exe) { console.error('usage: --exe <file.exe> [--pdb <file.pdb>] [--json out] [--top N]'); process.exit(2) }
  const pdb = flag('pdb') ?? exe.replace(/\.exe$/i, '.pdb')
  const top = Number(flag('top', '40'))
  const r = attribute(exe, pdb)

  console.log('== PE SECTION TABLE (read from the file) ==')
  console.log('exe            ' + exe)
  console.log('file size      ' + fmt(r.pe.fileSize).padStart(14))
  console.log('SizeOfImage    ' + fmt(r.pe.sizeOfImage).padStart(14))
  console.log('SizeOfHeaders  ' + fmt(r.pe.sizeOfHeaders).padStart(14) + '   fileAlign ' + r.pe.fileAlign + '  sectAlign ' + r.pe.sectAlign)
  console.log('')
  console.log('  section        vsize          rawsize        rawptr       attributed')
  let rawSum = 0
  for (const s of r.pe.sections) {
    rawSum += s.rawSize
    const at = r.bySection.get(s.name) ?? 0
    console.log('  ' + s.name.padEnd(10) + fmt(s.vsize).padStart(14) + fmt(s.rawSize).padStart(16) +
      fmt(s.rawPtr).padStart(13) + fmt(at).padStart(16))
  }
  console.log('  ' + 'SUM raw'.padEnd(10) + ''.padStart(14) + fmt(rawSum).padStart(16))
  console.log('  headers+raw = ' + fmt(rawSum + r.pe.sizeOfHeaders) + '   file = ' + fmt(r.pe.fileSize) +
    '   diff = ' + fmt(r.pe.fileSize - rawSum - r.pe.sizeOfHeaders))
  console.log('')
  console.log('  data directories:')
  for (const d of r.pe.dirs) console.log('    ' + d.name.padEnd(14) + 'rva ' + fmt(d.rva).padStart(12) + '  size ' + fmt(d.size).padStart(12))
  console.log('')
  console.log('== PDB SECTION CONTRIBUTIONS ==')
  console.log('modules ' + r.mods.size + '   contributions ' + fmt(r.contribs.length) +
    '   attributed bytes ' + fmt(r.attributed) + (r.unknownMods.size ? '   UNKNOWN MODS ' + r.unknownMods.size : ''))
  console.log('')
  const subs = [...r.bySubsystem.entries()].sort((a, b) => b[1].total - a[1].total)
  console.log('  subsystem        bytes         MiB     %attr   contribs')
  for (const [k, v] of subs) {
    console.log('  ' + k.padEnd(12) + fmt(v.total).padStart(14) + (v.total / 1048576).toFixed(2).padStart(10) +
      (100 * v.total / r.attributed).toFixed(2).padStart(9) + fmt(v.n).padStart(11))
  }
  console.log('  ' + 'TOTAL'.padEnd(12) + fmt(r.attributed).padStart(14) + (r.attributed / 1048576).toFixed(2).padStart(10))
  console.log('')
  console.log('== TOP ' + top + ' SOURCE FILES ==')
  const files = [...r.byFile.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, top)
  console.log('  file                                     bytes        MiB    .text    .rdata     .data     other')
  for (const [k, v] of files) {
    const g = (n) => fmt(v.sections.get(n) ?? 0).padStart(10)
    let other = 0
    for (const [sn, sv] of v.sections) if (!['.text', '.rdata', '.data'].includes(sn)) other += sv
    console.log('  ' + k.padEnd(40) + fmt(v.total).padStart(12) + (v.total / 1048576).toFixed(2).padStart(8) +
      g('.text') + g('.rdata') + g('.data') + fmt(other).padStart(10))
  }
  const jsonOut = flag('json')
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
      exe, pdb, pe: r.pe, attributed: r.attributed,
      bySubsystem: [...r.bySubsystem].map(([k, v]) => [k, { total: v.total, n: v.n, sections: [...v.sections] }]),
      byFile: [...r.byFile].map(([k, v]) => [k, { total: v.total, n: v.n, sections: [...v.sections] }]),
      bySection: [...r.bySection],
    }, null, 1), 'utf8')
    console.log('\n-> ' + jsonOut)
  }
}
