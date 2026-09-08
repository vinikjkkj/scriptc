/* rewrite-probe.mjs — show the npm-static rewritten text of a file, with line
 * numbers, so the fence location qualifier can be checked against the artifact
 * instead of guessed. Usage: node rewrite-probe.mjs <file.js> */
import { readFileSync } from 'node:fs'
import { rewriteBundlerCjsExports } from 'file:///<blocks>/clientbench/work/packages/compiler/dist/frontend/npm-static-rewrite.js'
const p = process.argv[2]
const src = readFileSync(p, 'utf8')
const raw = src.split('\n')
const trailing = raw[raw.length - 1] === ''
console.log(`on disk: split=${raw.length} trailingNewline=${trailing} realLines=${raw.length - (trailing ? 1 : 0)}`)
const ans = rewriteBundlerCjsExports(src, p)
if (ans === null) { console.log('rewrite returned null (not rewritten)'); process.exit(0) }
const text = typeof ans === 'string' ? ans : (ans.text ?? JSON.stringify(Object.keys(ans)))
if (typeof text !== 'string') { console.log('non-string answer:', JSON.stringify(ans).slice(0, 400)); process.exit(0) }
const lines = text.split('\n')
console.log(`rewritten: ${lines.length} split-parts`)
lines.forEach((l, i) => console.log(String(i + 1).padStart(3) + ' | ' + l))
