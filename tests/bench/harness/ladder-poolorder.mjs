/* ladder-poolorder.mjs (zapobench, mysql arm only): reorder the keys of the mysql.createPool({...}) literal in _store-factory.ts to
 * the order mysql2's PoolOptions shape enumerates (connectionLimit,user,password,database,host,port).
 * Compiler fence SC1090 "widening a record into an 'unknown'/'object' slot when this program does not build it the way its shape
 * enumerates" (the dyn value's key order is observable). mysql2 reads options by NAME, so Node behaviour is unchanged; both lanes
 * run the same reordered source. Recorded in the report as defect D9 (a deliberate exactness fence hit by the most ordinary
 * call shape), NOT as a fix. argv[2] = bench dir. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const f = join(process.argv[2], '_store-factory.ts'); const t = readFileSync(f, 'utf8')
const from = `    const rawPool = mysql.createPool({\n        host,\n        port,\n        user,\n        password,\n        database,\n        connectionLimit: 16\n    })`
const to = `    // zapobench: keys in the order PoolOptions enumerates them (SC1090 key-order fence), same values\n    const rawPool = mysql.createPool({\n        connectionLimit: 16,\n        user,\n        password,\n        database,\n        host,\n        port\n    })`
if (t.split(from).length !== 2) { console.error('poolorder: literal not found exactly once'); process.exit(4) }
writeFileSync(f, t.replace(from, to)); console.log('poolorder applied')
