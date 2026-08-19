/**
 * crosstab.mjs - do the two independent instruments agree on the SAME
 * procedures, or only on the same total?
 *
 * waproto.mjs attributes by the module globals a definition names;
 * dynshare.mjs attributes by the definition's C signature. Two rules that
 * agree on a total can still disagree on every row. This cross-tabulates
 * them procedure by procedure, in shipped .text bytes.
 */
import { scan, nameSpans } from './cscan.mjs'
import { moduleSymbols } from './drill.mjs'
import { pdbModules } from './attrib.mjs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const cFile = flag('c'), pdb = flag('pdb'), want = flag('m', '18')
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

const { buf, spans } = scan(cFile)
const named = nameSpans(buf, spans)
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
const sz = new Map()
let tot = 0
for (const s of moduleSymbols(pdb, modi)) { sz.set(s.name, (sz.get(s.name) ?? 0) + s.size); tot += s.size }

const G = /\bsc_g_m(\d+)_/g
const cell = new Map()
for (const s of named) {
  if (!s.name) continue
  const v = sz.get(s.name)
  if (v === undefined) continue
  const body = buf.toString('latin1', s.start, s.start + s.size)
  G.lastIndex = 0
  let m, hasWant = false
  while ((m = G.exec(body)) !== null) if (m[1] === want) { hasWant = true; break }
  const open = body.indexOf('(')
  const close = body.indexOf(')', open)
  const ret = body.slice(0, open)
  const parts = body.slice(open + 1, close).split(',').map((x) => x.trim()).filter((x) => x)
  const nonEnv = parts.filter((p) => !/^ScrClosure\s*\*/.test(p))
  const dyn = /ScrDyn\s*\*/.test(ret) && (nonEnv.length === 0 || nonEnv.every((p) => /^ScrDyn\s*\*/.test(p)))
  const k = (hasWant ? 'names m' + want : 'no m' + want) + '  x  ' + (dyn ? 'all-dyn signature' : 'typed signature')
  let e = cell.get(k); if (!e) { e = { n: 0, text: 0 }; cell.set(k, e) }
  e.n++; e.text += v
}
console.log('program .text ' + fmt(tot) + ' (' + (tot / 1048576).toFixed(2) + ' MiB)')
console.log('')
console.log('  cell                                       procs        .text  text MiB   %text')
for (const [k, v] of [...cell].sort((a, b) => b[1].text - a[1].text)) {
  console.log('  ' + k.padEnd(42) + fmt(v.n).padStart(7) + fmt(v.text).padStart(13) +
    (v.text / 1048576).toFixed(2).padStart(10) + (100 * v.text / tot).toFixed(2).padStart(8))
}
