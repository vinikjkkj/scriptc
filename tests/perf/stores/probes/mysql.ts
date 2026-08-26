import mysql from "mysql2/promise"

async function main(): Promise<void> {
  const c = await mysql.createConnection({ host: "127.0.0.1", port: 64714, database: "zapo_test", user: "root", password: "test" })
  await c.execute("CREATE TABLE IF NOT EXISTS probe (k VARCHAR(64) PRIMARY KEY, v TEXT)")
  await c.execute("REPLACE INTO probe (k, v) VALUES (?, ?)", ["probe:key", "probe-value"])
  const [rows] = await c.execute("SELECT v FROM probe WHERE k = ?", ["probe:key"])
  console.log("mysql got: " + (rows as unknown as { v: string }[])[0].v)
  await c.end()
}
main()
