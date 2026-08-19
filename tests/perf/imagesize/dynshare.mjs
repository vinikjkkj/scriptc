/**
 * dynshare.mjs - how much of the emitted program is DYNAMIC code?
 *
 * An independent instrument for the same question waproto.mjs answers by
 * module globals. It reads each definition's C SIGNATURE: a function whose
 * parameters and return are all `ScrDyn *` came from source the compiler
 * could not type - a minified bundle, an untyped .js twin - and every value
 * it touches goes through the dyn path. Typed program code has typed
 * signatures (ScrStr, ScrBytes, sc_rs_r<N>, double, bool, ...).
 *
 * The two instruments answer through completely different evidence, so
 * agreement between them is worth more than either alone.
 */
import { scan, nameSpans } from './cscan.mjs'
import { moduleSymbols } from './drill.mjs'
import { pdbModules } from './attrib.mjs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const cFile = flag('c'), pdb = flag('pdb')
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

const { buf, spans, fileSize } = scan(cFile)
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

const roll = new Map()
for (const s of named) {
  if (!s.name) continue
  const v = sz.get(s.name)
  if (v === undefined) continue
  // the signature is the first line of the span up to the opening brace
  const head = buf.toString('latin1', s.start, Math.min(s.start + 4000, s.end ?? s.start + s.size))
  const open = head.indexOf('(')
  const close = head.indexOf(')', open)
  if (open < 0 || close < 0) continue
  const ret = head.slice(0, open)
  const params = head.slice(open + 1, close)
  const retDyn = /ScrDyn\s*\*/.test(ret)
  const parts = params.split(',').map((x) => x.trim()).filter((x) => x.length > 0)
  const nonEnv = parts.filter((p) => !/^ScrClosure\s*\*/.test(p))
  const allDyn = nonEnv.length > 0 && nonEnv.every((p) => /^ScrDyn\s*\*/.test(p))
  const anyDyn = nonEnv.some((p) => /^ScrDyn\s*\*/.test(p)) || retDyn
  let k
  if (nonEnv.length === 0) k = retDyn ? 'no params, returns ScrDyn' : 'no params, typed return'
  else if (allDyn && retDyn) k = 'ALL-DYN (params and return)'
  else if (allDyn) k = 'all-dyn params, typed return'
  else if (anyDyn) k = 'mixed'
  else k = 'FULLY TYPED'
  let e = roll.get(k); if (!e) { e = { n: 0, text: 0, csrc: 0 }; roll.set(k, e) }
  e.n++; e.text += v; e.csrc += s.size
}

console.log('emitted C ' + fmt(fileSize) + '   program .text ' + fmt(tot) + ' (' + (tot / 1048576).toFixed(2) + ' MiB)')
console.log('')
console.log('  signature class                  procs        .text  text MiB   %text      C bytes')
let ts = 0
for (const [k, v] of [...roll].sort((a, b) => b[1].text - a[1].text)) {
  ts += v.text
  console.log('  ' + k.padEnd(32) + fmt(v.n).padStart(7) + fmt(v.text).padStart(13) +
    (v.text / 1048576).toFixed(2).padStart(10) + (100 * v.text / tot).toFixed(2).padStart(8) + fmt(v.csrc).padStart(13))
}
console.log('  ' + 'PLACED'.padEnd(32) + ''.padStart(7) + fmt(ts).padStart(13) + (ts / 1048576).toFixed(2).padStart(10) +
  (100 * ts / tot).toFixed(2).padStart(8))
