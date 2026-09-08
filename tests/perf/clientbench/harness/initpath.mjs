/* initpath.mjs — which deferred fences sit on a module's INITIALISATION path?
 *
 *   node initpath.mjs <emitted-dir>
 *
 * A fence inside a module's init function fires unconditionally on first
 * import; a fence inside any other function fires only if that function is
 * called. That distinction decides whether a --npm-static opt-in can work at
 * all, and it does not exist in the census today.
 *
 * It is read off the ARTIFACT, not guessed: the emitter puts a module's
 * top-level statements into `void sc_f__x25_init_N(void)`, whose opening line
 * carries a /* <source file>:1 *\/ comment naming the module. So the enclosing
 * C function of a fence is the answer, and no indentation heuristic is
 * involved -- an earlier attempt at one called index.js:19 a function body and
 * executing it proved otherwise.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: initpath.mjs <emitted-dir>'); process.exit(2) }

const FN_OPEN = /^[A-Za-z_][A-Za-z0-9_ *]*\b(sc_f_[A-Za-z0-9_]+)\s*\(/
const FENCE = /\[SC(\d{4}) at ([^\]]*)\]/g
const rows = []
let files = 0

for (const name of readdirSync(dir)) {
  if (!/\.(c|scrh)$/.test(name)) continue
  files++
  const lines = readFileSync(join(dir, name), 'latin1').split('\n')
  let fn = null
  let fnSrc = null
  for (const line of lines) {
    const open = FN_OPEN.exec(line)
    if (open && line.includes('{')) {
      fn = open[1]
      const c = /\/\* ([^*]+?) \*\//.exec(line)
      fnSrc = c ? c[1] : null
    } else if (line === '}') {
      fn = null; fnSrc = null
    }
    for (const m of line.matchAll(FENCE)) {
      rows.push({ code: 'SC' + m[1], at: m[2], fn, fnSrc })
    }
  }
}

const seen = new Map()
for (const r of rows) {
  const key = `${r.code}|${r.at}`
  if (!seen.has(key)) seen.set(key, r)
}
const isInit = (r) => r.fn !== null && /sc_f__x25_init_\d+$/.test(r.fn)
const out = [...seen.values()].sort((a, b) => a.at.localeCompare(b.at))

console.log(`scanned ${files} emitted file(s); ${out.length} distinct fence site(s)\n`)
console.log('  ON THE MODULE-INIT PATH (fires on first import):')
let n = 0
for (const r of out) if (isInit(r)) { n++; console.log(`    ${r.code}  ${short(r.at)}\n         in ${r.fn}  <- init of ${short(r.fnSrc ?? '?')}`) }
if (n === 0) console.log('    (none)')
console.log('\n  INSIDE A CALLED FUNCTION (fires only if that function runs):')
let m2 = 0
for (const r of out) if (!isInit(r)) { m2++; console.log(`    ${r.code}  ${short(r.at)}\n         in ${r.fn ?? '<no enclosing function found>'}`) }
if (m2 === 0) console.log('    (none)')
console.log(`\n  init-path ${n}   other ${m2}`)

function short(s) { return s.replace(/^.*(node_modules|prov\/[0-9a-f]{8}|bench-mex|bench-bench)/, '$1') }
