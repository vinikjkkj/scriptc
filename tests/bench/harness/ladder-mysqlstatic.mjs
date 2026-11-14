/* ladder-mysqlstatic.mjs (zapobench, mysql arm only): hoist `const mysql = await import('mysql2/promise')` to a static
 * `import mysql from 'mysql2/promise'` (the form @zapo-js/store-mysql itself uses). Reason: the compiled static tier cannot serve
 * a dynamic import() of a CommonJS package (mysql2/promise.js is authored CJS): the build SUCCEEDS and the site becomes a
 * REJECTED PROMISE at run time ("Cannot load module 'mysql2/promise': dynamic import() of npm packages runs in the embedded
 * dynamic engine"). That is a deferred runtime throw, recorded as OPEN defect D10; this patch only moves the load to a static
 * edge (same module object in Node: createPool is the same function). Both lanes run the same source. argv[2] = bench dir. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const f = join(process.argv[2], '_store-factory.ts'); let t = readFileSync(f, 'utf8')
const dyn = `    const mysql = await import('mysql2/promise')\n`
if (t.split(dyn).length !== 2) { console.error('mysqlstatic: dynamic import not found exactly once'); process.exit(4) }
t = t.replace(dyn, '')
const anchor = `import { createStore, type WaCreateStoreOptions, type WaStore } from 'zapo-js'\n`
if (t.split(anchor).length !== 2) { console.error('mysqlstatic: anchor not found'); process.exit(5) }
t = t.replace(anchor, anchor + `import mysql from 'mysql2/promise'\n`)
writeFileSync(f, t); console.log('mysqlstatic applied')
