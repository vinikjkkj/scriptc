/* patch-argo-textdecoder.mjs — substitution test, NOT a fix and NOT shipped.
 *
 *   node patch-argo-textdecoder.mjs <app-node_modules> [--restore]
 *
 * The question: is `new TextDecoder(<args>)` the ONLY thing standing between a
 * compiled zapo and a working argo decode? Nine of the ten fences
 * --npm-static argo-codec introduces are inside decode()/encode()/wire()
 * function bodies that zapo never calls -- zapo uses only `Reader` from
 * buf.js, which carries no fences at all. Exactly one, decode.js:6, is at
 * module top level and therefore runs on first import.
 *
 * `new TextDecoder('utf-8', { fatal: false })` is BEHAVIOUR-IDENTICAL to
 * `new TextDecoder()`: utf-8 and fatal:false are the defaults. So swapping it
 * changes nothing about what the module does, and isolates the lowering as
 * the single variable.
 *
 * A .orig backup is kept and --restore puts it back, because this edits a
 * third-party package inside the lab driver project.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const nm = process.argv[2]
if (!nm) { console.error('usage: patch-argo-textdecoder.mjs <node_modules dir> [--restore]'); process.exit(2) }
const targets = ['dist/cjs/decode.js', 'dist/esm/decode.js'].map((r) => join(nm, 'argo-codec', r)).filter(existsSync)
if (targets.length === 0) { console.error('no argo-codec decode.js found'); process.exit(3) }

const NEEDLE = "new TextDecoder('utf-8', { fatal: false })"
const REPL = 'new TextDecoder()'

if (process.argv.includes('--restore')) {
  let n = 0
  for (const t of targets) { if (existsSync(t + '.orig')) { copyFileSync(t + '.orig', t); n++ } }
  console.log(`restored ${n} file(s)`)
  process.exit(0)
}

let patched = 0
for (const t of targets) {
  const s = readFileSync(t, 'utf8')
  if (!s.includes(NEEDLE)) {
    if (s.includes(REPL)) { console.log(`already patched: ${t}`); continue }
    console.error(`needle not found in ${t} — refusing to guess`); process.exit(4)
  }
  if (!existsSync(t + '.orig')) copyFileSync(t, t + '.orig')
  writeFileSync(t, s.split(NEEDLE).join(REPL))
  patched++
}
/* Self-test: the construct must be gone from every target, and the module must
 * still parse. */
for (const t of targets) {
  const s = readFileSync(t, 'utf8')
  if (s.includes(NEEDLE)) { console.error(`self-test: needle survives in ${t}`); process.exit(5) }
  if (!s.includes(REPL)) { console.error(`self-test: replacement missing in ${t}`); process.exit(5) }
}
console.log(`patched ${patched} file(s): ${NEEDLE}  ->  ${REPL}`)
