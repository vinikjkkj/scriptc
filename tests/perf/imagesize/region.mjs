/**
 * region.mjs - is the waproto module a CONTIGUOUS region of the emitted C?
 *
 * The globals rule (waproto.mjs) attributes only the spans that literally
 * name `sc_g_m18_...`; a helper of the same module that touches no global
 * falls into `<no module global>` and UNDER-counts the module. The emitter
 * writes one module at a time, so the module's true extent is the byte
 * range its globals span. This measures that range, what else lives inside
 * it, and the shipped .text of everything inside - which brackets the
 * module between a lower bound (globals only) and an upper bound (the
 * whole contiguous region).
 */
import { scan, nameSpans } from './cscan.mjs'
import { moduleSymbols } from './drill.mjs'
import { pdbModules } from './attrib.mjs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const cFile = flag('c'), pdb = flag('pdb')
const want = flag('m', '18')
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

const { buf, spans, fileSize } = scan(cFile)
const named = nameSpans(buf, spans)
const G = /\bsc_g_m(\d+)_/g
const tag = []
let lo = Infinity, hi = -1, nWant = 0, cWant = 0
for (const s of named) {
  const b = buf.toString('latin1', s.start, s.start + s.size)
  G.lastIndex = 0
  let m, has = false, other = false
  while ((m = G.exec(b)) !== null) { if (m[1] === want) has = true; else other = true }
  tag.push(has ? 'want' : (other ? 'other' : 'none'))
  if (has) { nWant++; cWant += s.size; if (s.start < lo) lo = s.start; if (s.start + s.size > hi) hi = s.start + s.size }
}
console.log('emitted C          ' + fmt(fileSize))
console.log('m' + want + ' spans (globals)  ' + fmt(nWant) + '   C bytes ' + fmt(cWant) + ' (' + (cWant / 1048576).toFixed(2) + ' MiB)')
console.log('m' + want + ' byte range       ' + fmt(lo) + ' .. ' + fmt(hi) + '   = ' + fmt(hi - lo) +
  ' (' + (100 * (hi - lo) / fileSize).toFixed(2) + '% of the file)')

let inN = 0, inC = 0, othN = 0, othC = 0, noneN = 0, noneC = 0
for (let i = 0; i < named.length; i++) {
  const s = named[i]
  if (s.start < lo || s.start + s.size > hi) continue
  inN++; inC += s.size
  if (tag[i] === 'other') { othN++; othC += s.size }
  else if (tag[i] === 'none') { noneN++; noneC += s.size }
}
console.log('inside the range   ' + fmt(inN) + ' spans, ' + fmt(inC) + ' C bytes')
console.log('  of which touch ANOTHER module\'s globals: ' + fmt(othN) + ' spans, ' + fmt(othC) + ' bytes')
console.log('  of which touch NO module global:         ' + fmt(noneN) + ' spans, ' + fmt(noneC) + ' bytes')

if (!pdb) process.exit(0)
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
let textIn = 0, textWant = 0
for (let i = 0; i < named.length; i++) {
  const s = named[i]
  const v = s.name ? sz.get(s.name) : undefined
  if (v === undefined) continue
  if (tag[i] === 'want') textWant += v
  if (s.start >= lo && s.start + s.size <= hi) textIn += v
}
console.log('')
console.log('program .text total          ' + fmt(tot) + ' (' + (tot / 1048576).toFixed(2) + ' MiB)')
console.log('LOWER bound (globals only)   ' + fmt(textWant) + ' (' + (textWant / 1048576).toFixed(2) + ' MiB) = ' +
  (100 * textWant / tot).toFixed(2) + '%')
console.log('UPPER bound (whole region)   ' + fmt(textIn) + ' (' + (textIn / 1048576).toFixed(2) + ' MiB) = ' +
  (100 * textIn / tot).toFixed(2) + '%')
