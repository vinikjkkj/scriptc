/**
 * module-share.mjs - how much of the image belongs to ONE module, measured by
 * the module's own globals rather than by position.
 *
 * The emitted C tags declared names with `%m<i>` but leaves ANONYMOUS
 * functions untagged, and the untagged run is most of the file - so the
 * "nearest preceding tag" rule that works for declarations mis-attributes
 * the bulk. A module's globals do not move: every function that belongs to
 * module i reads or writes `sc_g_m<i>_...`. This counts spans by the
 * module whose globals they touch, and reports the spans that touch
 * SEVERAL modules' globals separately instead of picking a winner.
 *
 * Usage: node module-share.mjs --c out.c --pdb out.pdb [--top 20]
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { scan, nameSpans } from './cscan.mjs'
import { moduleSymbols } from './drill.mjs'
import { pdbModules } from './attrib.mjs'

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const cFile = flag('c'), pdb = flag('pdb')
if (!cFile) { console.error('usage: --c out.c [--pdb out.pdb]'); process.exit(2) }
const top = Number(flag('top', '20'))

const { buf, spans, fileSize } = scan(cFile)
const named = nameSpans(buf, spans)
console.log('emitted C ' + fmt(fileSize) + ' bytes in ' + fmt(spans.length) + ' spans')

let symSize = new Map()
let symTotal = 0
if (pdb) {
  const mods = pdbModules(pdb)
  const rtRe = /^scr_[a-z0-9_]+\.(obj|o)$/
  const roots = new Set()
  for (const [, p] of mods) {
    const s = p.split(String.fromCharCode(92)).join('/')
    const b = s.slice(s.lastIndexOf('/') + 1)
    if (rtRe.test(b)) { const d = s.slice(0, s.lastIndexOf('/')); roots.add(d.slice(0, d.lastIndexOf('/'))) }
  }
  let modi = -1
  for (const [i, p] of mods) {
    const s = p.split(String.fromCharCode(92)).join('/')
    const b = s.slice(s.lastIndexOf('/') + 1)
    if (rtRe.test(b) || !/\.(obj|o)$/.test(b) || /^monocypher/.test(b)) continue
    const d = s.slice(0, s.lastIndexOf('/'))
    if (roots.has(d.slice(0, d.lastIndexOf('/')))) { modi = i; break }
  }
  for (const s of moduleSymbols(pdb, modi)) { symSize.set(s.name, (symSize.get(s.name) ?? 0) + s.size); symTotal += s.size }
  console.log('program module ' + modi + ': ' + fmt(symTotal) + ' shipped code bytes in ' + fmt(symSize.size) + ' procedures')
}

const GLOBAL = /\bsc_g_m(\d+)_/g
const roll = new Map()
const MIXED = '<touches several modules>'
const NONE = '<no module global>'
for (const s of named) {
  const body = buf.toString('latin1', s.start, s.start + s.size)
  const seen = new Map()
  let m
  GLOBAL.lastIndex = 0
  while ((m = GLOBAL.exec(body)) !== null) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1)
  let key
  if (seen.size === 0) key = NONE
  else if (seen.size === 1) key = 'm' + [...seen.keys()][0]
  else {
    const r = [...seen].sort((a, b) => b[1] - a[1])
    key = r[0][1] >= 4 * r[1][1] ? 'm' + r[0][0] : MIXED
  }
  let e = roll.get(key); if (!e) { e = { csrc: 0, text: 0, n: 0 }; roll.set(key, e) }
  e.csrc += s.size; e.n++
  const sz = s.name ? symSize.get(s.name) : undefined
  if (sz !== undefined) e.text += sz
}

const rows = [...roll].sort((a, b) => b[1].csrc - a[1].csrc)
console.log('')
console.log('  bucket                          spans      C bytes    C MiB       .text  text MiB   %text')
for (const [k, v] of rows.slice(0, top)) {
  console.log('  ' + k.padEnd(30) + fmt(v.n).padStart(8) + fmt(v.csrc).padStart(13) +
    (v.csrc / 1048576).toFixed(2).padStart(9) + fmt(v.text).padStart(12) +
    (v.text / 1048576).toFixed(2).padStart(10) + (symTotal ? (100 * v.text / symTotal).toFixed(2).padStart(8) : ''))
}
let cs = 0, ts = 0, ns = 0
for (const [, v] of rows) { cs += v.csrc; ts += v.text; ns += v.n }
console.log('  ' + 'TOTAL'.padEnd(30) + fmt(ns).padStart(8) + fmt(cs).padStart(13) +
  (cs / 1048576).toFixed(2).padStart(9) + fmt(ts).padStart(12) + (ts / 1048576).toFixed(2).padStart(10))
