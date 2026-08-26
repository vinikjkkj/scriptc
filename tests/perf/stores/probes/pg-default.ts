import pg from "pg"

async function main(): Promise<void> {
  const c = new pg.Client({ host: "127.0.0.1", port: 64713, user: "postgres", password: "test", database: "zapo_test" })
  await c.connect()
  await c.query("CREATE TABLE IF NOT EXISTS probe (k text primary key, v text)")
  await c.query("INSERT INTO probe (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = $2", ["probe:key", "probe-value"])
  const res = await c.query("SELECT v FROM probe WHERE k = $1", ["probe:key"])
  console.log("pg got: " + (res.rows as unknown as { v: string }[])[0].v)
  await c.end()
}
main()
