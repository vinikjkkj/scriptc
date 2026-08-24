/**
 * lits.mjs - the interned string literals of an emitted TU: how many, how
 * many bytes, and whether any CONTENT is declared more than once.
 *
 * A duplicated literal is pure waste in .data; a literal declared once and
 * referenced many times is the emitter interning correctly. The distinction
 * is the whole point, so both counts are printed rather than the total.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const cFile = flag('c')
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

const t = readFileSync(cFile, 'latin1')
const lines = t.split('\n')
let n = 0, bytes = 0
const seen = new Map()
// The emitter spells the literal's layout with scr_runtime.h's SCR_STR_LIT
// macro rather than inline, so the header width lives in ONE place and is
// static-asserted against the real ScrStr. This reader has to know that
// width to price the headers, and it cannot read it out of the TU - so it
// is named here, once, beside the macro it tracks.
const HDR_BYTES = 12 // sizeof(ScrStr): uint32 rc, len, cap
const declRe = /^static SCR_STR_LIT\((\d+)\) (sc_lit_\d+) =/
for (let i = 0; i < lines.length; i++) {
  const m = declRe.exec(lines[i])
  if (!m) continue
  n++
  bytes += Number(m[1])
  // the initializer is on this line or the next
  let init = lines[i].slice(m[0].length)
  if (init.trim().length === 0 && i + 1 < lines.length) init = lines[i + 1]
  const q = init.indexOf('"')
  const content = q < 0 ? '<?>' : init.slice(q)
  seen.set(content, (seen.get(content) ?? 0) + 1)
}
let dupDecls = 0, dupBytes = 0
for (const [c, k] of seen) if (k > 1) { dupDecls += k - 1; dupBytes += (k - 1) * c.length }
console.log('literal declarations      ' + fmt(n))
console.log('distinct contents         ' + fmt(seen.size))
console.log('declared data bytes       ' + fmt(bytes) + '  (+ ' + HDR_BYTES + ' bytes of header each = ' + fmt(bytes + HDR_BYTES * n) + ')')
console.log('duplicate declarations    ' + fmt(dupDecls) + '   approx wasted ' + fmt(dupBytes) + ' bytes')
const refs = (t.match(/\bsc_lit_\d+\b/g) ?? []).length
console.log('references to literals    ' + fmt(refs) + '   mean uses per literal ' + (refs / n).toFixed(1))
const big = [...seen].sort((a, b) => b[0].length - a[0].length).slice(0, 6)
console.log('')
console.log('longest literals:')
for (const [c, k] of big) console.log('  ' + String(c.length).padStart(7) + ' bytes  x' + k + '  ' + c.slice(0, 100))
