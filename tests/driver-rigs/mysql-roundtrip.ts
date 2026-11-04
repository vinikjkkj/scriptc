import { createConnection } from "mysql2/promise";

// The round trip against a real server (the workflow's mysql service): connect, CREATE TABLE, INSERT with parameters, SELECT with
// parameters, a rolled-back and a committed transaction, close. Every printed line is compared with Node's.
async function main(): Promise<void> {
  const conn = await createConnection({ host: "127.0.0.1", port: 3306, user: "root", password: "p", database: "d" });
  await conn.query("DROP TABLE IF EXISTS rt");
  await conn.query("CREATE TABLE rt (id INT PRIMARY KEY, name VARCHAR(40) NOT NULL, score DOUBLE, note TEXT)");
  console.log("create");
  const [inserted] = await conn.query("INSERT INTO rt (id, name, score, note) VALUES (?, ?, ?, ?), (?, ?, ?, ?)", [1, "alpha", 1.5, null, 2, "beta", 2.25, "x"]);
  console.log("insert", JSON.stringify(inserted));
  const [rows, fields] = await conn.query("SELECT id, name, score, note FROM rt WHERE score > ? ORDER BY id", [1]);
  console.log("select", Array.isArray(fields) ? fields.length : -1, JSON.stringify(rows));
  const [prepared] = await conn.execute("SELECT id, name FROM rt WHERE id = ?", [2]);
  console.log("execute", JSON.stringify(prepared));
  await conn.beginTransaction();
  await conn.query("UPDATE rt SET score = score + ? WHERE id = ?", [10, 1]);
  await conn.rollback();
  await conn.beginTransaction();
  const [updated] = await conn.query("UPDATE rt SET score = score + ? WHERE id = ?", [10, 2]);
  await conn.commit();
  console.log("update", JSON.stringify(updated));
  const [after] = await conn.query("SELECT id, score FROM rt ORDER BY id");
  console.log("after", JSON.stringify(after));
  try {
    await conn.query("INSERT INTO rt (id, name) VALUES (?, ?)", [1, "dup"]);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log("error", err.code, err.errno, err.message);
  }
  await conn.query("DROP TABLE rt");
  await conn.end();
  console.log("closed");
}
main().catch((e) => console.log("failed", (e as Error).message));
