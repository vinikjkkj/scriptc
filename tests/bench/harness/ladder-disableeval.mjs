/* ladder-disableeval.mjs (zapobench, mysqlde variant): add `disableEval: true` to the mysql.createPool literal, so mysql2 3.24.5 selects its
 * static text/binary parsers instead of generating them with new Function. Bench copy only; applied to ALL lanes of the variant.
 * Placed after `port` (PoolOptions member order is not observable on this typed call). argv[2] = bench dir. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const f = join(process.argv[2], '_store-factory.ts'); const t = readFileSync(f, 'utf8')
const from = `        host,\n        port\n    })`
if (t.split(from).length !== 2) { console.error('disableeval: literal tail not found exactly once'); process.exit(4) }
writeFileSync(f, t.replace(from, `        host,\n        port,\n        disableEval: true\n    })`)); console.log('disableEval applied')
