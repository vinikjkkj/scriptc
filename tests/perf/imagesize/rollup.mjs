/**
 * rollup.mjs - zapo's image, attributed to SOURCE FILES.
 *
 * Three artefacts are joined, and each carries its own check:
 *
 *   1. the emitted .c, split into top-level spans (cscan.mjs). Its check is
 *      that the spans cover every byte of the file exactly.
 *   2. the PDB's per-procedure code sizes for the program module
 *      (drill.mjs). Its check is that the sum of procedure sizes stays
 *      under the module's own .text contribution from attrib.mjs.
 *   3. the %m<i> -> source file map (name-modules.mjs), which reports its
 *      own unresolved and ambiguous tags.
 *
 * The join is by C identifier. Every emitted definition carries a module
 * tag OR inherits the tag of the nearest preceding tagged definition - the
 * emitter writes module by module, and the MONOTONICITY of the tags through
 * the file is measured and printed, so the inheritance rule is quoted with
 * the rate at which it is violated rather than assumed.
 *
 * Usage:
 *   node rollup.mjs --c out.c --pdb out.pdb --names modnames.json [--top 40]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { scan, nameSpans } from './cscan.mjs'
import { moduleSymbols } from './drill.mjs'
import { pdbModules } from './attrib.mjs'

const TAG = /_x25_m(\d+)_/

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
  const cFile = flag('c'), pdb = flag('pdb'), namesFile = flag('names')
  const top = Number(flag('top', '40'))
  if (!cFile || !pdb || !namesFile) { console.error('usage: --c out.c --pdb out.pdb --names modnames.json'); process.exit(2) }

  const names = new Map(JSON.parse(readFileSync(namesFile, 'utf8')).map((n) => [n.tag, n.file]))

  const { buf, spans, fileSize } = scan(cFile)
  const covered = spans.reduce((a, s) => a + (s.end - s.start), 0)
  const named = nameSpans(buf, spans)
  console.log('emitted C      ' + fmt(fileSize) + ' bytes, ' + fmt(spans.length) + ' spans, coverage ' +
    (covered === fileSize ? 'EXACT' : 'MISMATCH ' + fmt(fileSize - covered)))

  // inherit the nearest preceding tag; measure how often the tag goes BACKWARDS
  let cur = null, violations = 0, taggedSpans = 0, last = -1
  const spanTag = []
  for (const s of named) {
    const m = s.name ? TAG.exec(s.name) : null
    if (m) {
      const t = Number(m[1])
      taggedSpans++
      if (t < last) violations++
      last = t; cur = t
    }
    spanTag.push(cur)
  }
  console.log('module tags    ' + fmt(taggedSpans) + ' tagged spans, ' + violations +
    ' out of order (' + (100 * violations / Math.max(1, taggedSpans)).toFixed(2) + '%)')

  // PDB: procedure -> shipped code bytes
  const mods = pdbModules(pdb)
  let modi = -1, modName = null
  const rtRe = /^scr_[a-z0-9_]+\.(obj|o)$/
  const cacheRoots = new Set()
  for (const [, p] of mods) {
    const s = p.split(String.fromCharCode(92)).join('/')
    const b = s.slice(s.lastIndexOf('/') + 1)
    if (rtRe.test(b)) { const d = s.slice(0, s.lastIndexOf('/')); cacheRoots.add(d.slice(0, d.lastIndexOf('/'))) }
  }
  for (const [i, p] of mods) {
    const s = p.split(String.fromCharCode(92)).join('/')
    const b = s.slice(s.lastIndexOf('/') + 1)
    if (rtRe.test(b) || !/\.(obj|o)$/.test(b)) continue
    const d = s.slice(0, s.lastIndexOf('/'))
    if (cacheRoots.has(d.slice(0, d.lastIndexOf('/'))) && !/^monocypher/.test(b)) { modi = i; modName = p; break }
  }
  if (modi < 0) { console.error('could not find the emitted program module in the PDB'); process.exit(3) }
  console.log('program module ' + modi + ' = ' + modName)
  const syms = moduleSymbols(pdb, modi)
  const symSize = new Map()
  for (const s of syms) symSize.set(s.name, (symSize.get(s.name) ?? 0) + s.size)
  const symTotal = syms.reduce((a, s) => a + s.size, 0)
  console.log('shipped procs  ' + fmt(syms.length) + '   code bytes ' + fmt(symTotal) +
    ' (' + (symTotal / 1048576).toFixed(2) + ' MiB)')
  console.log('')

  const roll = new Map()
  let matched = 0, matchedBytes = 0
  for (let i = 0; i < named.length; i++) {
    const s = named[i]
    const tag = spanTag[i]
    const key = tag === null ? '<entry / pre-module>' : (names.get(tag) ?? ('%m' + tag + ' (unresolved)'))
    let e = roll.get(key); if (!e) { e = { csrc: 0, text: 0, spans: 0, procs: 0 }; roll.set(key, e) }
    e.csrc += s.size; e.spans++
    const sz = s.name ? symSize.get(s.name) : undefined
    if (sz !== undefined) { e.text += sz; e.procs++; matched++; matchedBytes += sz }
  }
  console.log('joined         ' + fmt(matched) + ' spans carry a shipped procedure; ' +
    fmt(matchedBytes) + ' of ' + fmt(symTotal) + ' code bytes placed (' +
    (100 * matchedBytes / symTotal).toFixed(2) + '%)')
  console.log('')

  const rows = [...roll].sort((a, b) => b[1].text - a[1].text)
  console.log('  source file                                                     C bytes    C MiB     .text  text MiB   procs')
  for (const [k, v] of rows.slice(0, top)) {
    const short = k.replace(/^.*\/provenance\/[0-9a-f]+\//, '').replace(/^.*\/node_modules\//, 'node_modules/')
    console.log('  ' + short.slice(0, 60).padEnd(62) + fmt(v.csrc).padStart(11) + (v.csrc / 1048576).toFixed(2).padStart(9) +
      fmt(v.text).padStart(11) + (v.text / 1048576).toFixed(2).padStart(10) + fmt(v.procs).padStart(8))
  }
  let ct = 0, tt = 0
  for (const [, v] of rows) { ct += v.csrc; tt += v.text }
  console.log('  ' + 'TOTAL'.padEnd(62) + fmt(ct).padStart(11) + (ct / 1048576).toFixed(2).padStart(9) +
    fmt(tt).padStart(11) + (tt / 1048576).toFixed(2).padStart(10))
  console.log('  (' + rows.length + ' distinct files)')

  const jsonOut = flag('json')
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ cFile, pdb, fileSize, symTotal, matchedBytes,
      rows: rows.map(([k, v]) => [k, v]) }, null, 1), 'utf8')
    console.log('-> ' + jsonOut)
  }
}
