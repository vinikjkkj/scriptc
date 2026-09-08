/* engine.mjs — is the dynamic (quickjs) engine in this binary?
 *
 *   node engine.mjs <exe> [...]
 *
 * Counts the markers this fleet standardised on. Only `quickjs` and `ScrDyn`
 * discriminate: `JS_NewRuntime`, `JS_Eval` and `__island_eval` read 0 even in
 * a known --dynamic control, so a zero on those three is not evidence.
 *
 * Destructors never run in these PE binaries and there is no .CRT section, so
 * a string surviving into .rdata is not proof a path executes — a byte scan
 * answers "is the engine linked in", not "is it used".
 */
import { readFileSync, statSync } from 'node:fs'

const MARKERS = ['quickjs', 'ScrDyn', 'JS_NewRuntime', 'JS_Eval', '__island_eval']
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: engine.mjs <exe> [...]')
  process.exit(2)
}
for (const f of files) {
  const s = readFileSync(f, 'latin1')
  const parts = MARKERS.map((m) => {
    let n = 0
    let i = s.indexOf(m)
    while (i >= 0) {
      n++
      i = s.indexOf(m, i + 1)
    }
    return `${m} ${n}`
  })
  console.log(`${f}  ${statSync(f).size} bytes`)
  console.log('  ' + parts.join('   '))
  console.log('  discriminating: quickjs/ScrDyn — the other three read 0 even under --dynamic')
}
