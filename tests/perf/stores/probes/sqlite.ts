import Database from "better-sqlite3"

function main(): void {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE probe (k TEXT PRIMARY KEY, v TEXT)")
  db.prepare("INSERT INTO probe (k, v) VALUES (?, ?)").run("probe:key", "probe-value")
  const row = db.prepare("SELECT v FROM probe WHERE k = ?").get("probe:key")
  console.log("sqlite got: " + (row as unknown as { v: string }).v)
  db.close()
}
main()
