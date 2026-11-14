// resetdb.mjs <store>: give every run an empty database (drop+create zapo_test), so no arm inherits another's rows.
// Runs with the app's node_modules (mysql2, pg). Exit 0 on success, 1 on failure (a failed reset must stop the run).
import { createRequire } from 'node:module'
const req = createRequire(process.env.ZB_APP + '/package.json')
const store = process.argv[2]
if (store === 'mysql') {
  const m = req('mysql2/promise')
  const c = await m.createConnection({ host: process.env.ZAPO_TEST_MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.ZAPO_TEST_MYSQL_PORT ?? 33417), user: 'root', password: process.env.ZAPO_TEST_MYSQL_PASSWORD ?? '' })
  await c.query('DROP DATABASE IF EXISTS zapo_test'); await c.query('CREATE DATABASE zapo_test'); await c.end()
} else if (store === 'postgres') {
  const pg = req('pg')
  const c = new pg.Client({ host: process.env.ZAPO_TEST_PG_HOST ?? '127.0.0.1', port: Number(process.env.ZAPO_TEST_PG_PORT ?? 33418), user: 'postgres', password: process.env.ZAPO_TEST_PG_PASSWORD ?? 'x', database: 'postgres' })
  await c.connect(); await c.query('DROP DATABASE IF EXISTS zapo_test WITH (FORCE)'); await c.query('CREATE DATABASE zapo_test'); await c.end()
} else if (store === 'redis') {
  const { Redis } = req('ioredis')
  const r = new Redis({ host: process.env.ZAPO_TEST_REDIS_HOST ?? '127.0.0.1', port: Number(process.env.ZAPO_TEST_REDIS_PORT ?? 16379), lazyConnect: false })
  await r.flushall(); await r.quit()
}
