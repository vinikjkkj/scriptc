/* scc.mjs — the ONLY entry point that may invoke the scriptc CLI in this block.
 * Runs guard.mjs for effect (which exits non-zero if any cache var is unset or
 * off G:) and only then hands argv to packages/cli/dist/main.js.
 */
import './guard.mjs'
import { pathToFileURL } from 'node:url'

const raw = process.env.SCC_RAW
if (!raw) {
  console.error('SCC_RAW is unset; source lab/env.sh')
  process.exit(2)
}
process.argv = [process.argv[0], raw, ...process.argv.slice(2)]
await import(pathToFileURL(raw).href)
