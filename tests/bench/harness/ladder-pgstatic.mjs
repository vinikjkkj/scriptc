/* ladder-pgstatic.mjs (zapobench, postgres arm only): hoist `const pg = await import('pg')` to a static `import pg from 'pg'`
 * (same module object in Node), as ladder-mysqlstatic does for mysql2: the compiled static tier cannot serve a dynamic import() of a
 * CommonJS package that is not a compiled twin (D10b). Both lanes run the same source. argv[2] = bench dir. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const f = join(process.argv[2], '_store-factory.ts'); let t = readFileSync(f, 'utf8')
const dyn = `    const pg = await import('pg')\n`
if (t.split(dyn).length !== 2) { console.error('pgstatic: dynamic import not found exactly once'); process.exit(4) }
t = t.replace(dyn, '')
const anchor = `import { createStore, type WaCreateStoreOptions, type WaStore } from 'zapo-js'\n`
if (t.split(anchor).length !== 2) { console.error('pgstatic: anchor not found'); process.exit(5) }
writeFileSync(f, t.replace(anchor, anchor + `import pg from 'pg'\n`)); console.log('pgstatic applied')
