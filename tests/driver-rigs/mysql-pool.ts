import { createPool } from "mysql2/promise";
import type { FieldPacket, PoolConnection, ResultSetHeader } from "mysql2/promise";

// The zapo store-mysql call shape: an executor typed as the pool connection's `execute`, its result handed to helpers that take the
// [rows, fields] tuple. An INSERT or UPDATE answers [ResultSetHeader, undefined], a SELECT [rows, fields]: both must flow through.
type QueryOutput = [unknown, FieldPacket[]];
function queryRows(output: QueryOutput): Record<string, unknown>[] {
  return output[0] as Record<string, unknown>[];
}
function affectedRows(output: QueryOutput): number {
  return (output[0] as ResultSetHeader).affectedRows;
}
async function viaExecutor(executor: { execute: PoolConnection["execute"] }): Promise<void> {
  const inserted = affectedRows(await executor.execute("INSERT INTO pt (id, name, score) VALUES (?, ?, ?)", [10, "delta", 4.5]));
  const updated = affectedRows(await executor.execute("UPDATE pt SET score = score + ? WHERE id = ?", [1, 10]));
  const rows = queryRows(await executor.execute("SELECT id, name, score FROM pt WHERE id = ?", [10]));
  console.log("executor", inserted, updated, JSON.stringify(rows));
  const removed = affectedRows(await executor.execute("DELETE FROM pt WHERE id = ?", [10]));
  console.log("executor delete", removed);
}


// The pool path against a real server (the workflow's mysql service): pool.query and pool.execute (prepared) for DDL, writes, reads and
// a failing statement, a connection checked out of the pool, pool.end. Every printed line is compared with Node's.
async function main(): Promise<void> {
  const pool = createPool({ host: "127.0.0.1", port: 3306, user: "root", password: "p", database: "d", connectionLimit: 2 });
  const [ping] = await pool.query("SELECT 1 AS one");
  console.log("ping", JSON.stringify(ping));
  await pool.query("DROP TABLE IF EXISTS pt");
  await pool.query("CREATE TABLE pt (id INT PRIMARY KEY, name VARCHAR(40) NOT NULL, score DOUBLE)");
  console.log("create");
  const [inserted] = await pool.query("INSERT INTO pt (id, name, score) VALUES (?, ?, ?), (?, ?, ?)", [1, "alpha", 1.5, 2, "beta", 2.25]);
  console.log("query insert", JSON.stringify(inserted));
  const [executed] = await pool.execute("INSERT INTO pt (id, name, score) VALUES (?, ?, ?)", [3, "gamma", 3.5]);
  console.log("execute insert", JSON.stringify(executed));
  const [qrows, qfields] = await pool.query("SELECT id, name, score FROM pt WHERE score > ? ORDER BY id", [1]);
  console.log("query select", Array.isArray(qfields) ? qfields.length : -1, JSON.stringify(qrows));
  const [erows, efields] = await pool.execute("SELECT id, name, score FROM pt WHERE id >= ? ORDER BY id", [2]);
  console.log("execute select", Array.isArray(efields) ? efields.length : -1, JSON.stringify(erows));
  const [again] = await pool.execute("SELECT name FROM pt WHERE id = ?", [1]);
  console.log("execute again", JSON.stringify(again));
  const [counted, maxed] = await Promise.all([pool.execute("SELECT COUNT(*) AS n FROM pt"), pool.query("SELECT MAX(id) AS m FROM pt")]);
  console.log("parallel", JSON.stringify(counted[0]), JSON.stringify(maxed[0]));
  const conn = await pool.getConnection();
  const [held] = await conn.execute("SELECT id FROM pt WHERE name = ?", ["beta"]);
  console.log("held", JSON.stringify(held));
  conn.release();
  const held2 = await pool.getConnection();
  await viaExecutor(held2);
  held2.release();
  try {
    await pool.execute("INSERT INTO pt (id, name) VALUES (?, ?)", [1, "dup"]);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log("execute error", err.code, err.errno, err.message);
  }
  try {
    await pool.query("INSERT INTO pt (id, name) VALUES (?, ?)", [1, "dup"]);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log("query error", err.code, err.errno, err.message);
  }
  await pool.query("DROP TABLE pt");
  await pool.end();
  console.log("closed");
}
main().catch((e) => console.log("failed", (e as Error).message));
