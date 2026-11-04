import { Client } from "pg";

// The round trip against a real server (the workflow's postgres service): connect, CREATE TABLE, INSERT with parameters, SELECT with
// parameters, a rolled-back and a committed transaction, close. Every printed line is compared with Node's.
async function main(): Promise<void> {
  const client = new Client({ host: "127.0.0.1", port: 5432, user: "postgres", password: "p", database: "postgres" });
  await client.connect();
  await client.query("DROP TABLE IF EXISTS rt");
  const created = await client.query("CREATE TABLE rt (id integer PRIMARY KEY, name text NOT NULL, score double precision, note text)");
  console.log("create", created.command);
  const inserted = await client.query("INSERT INTO rt (id, name, score, note) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)", [1, "alpha", 1.5, null, 2, "beta", 2.25, "x"]);
  console.log("insert", inserted.command, inserted.rowCount);
  const selected = await client.query("SELECT id, name, score, note FROM rt WHERE score > $1 ORDER BY id", [1]);
  console.log("select", selected.rowCount, selected.fields.map((f) => f.name).join(","), JSON.stringify(selected.rows));
  await client.query("BEGIN");
  await client.query("UPDATE rt SET score = score + $1 WHERE id = $2", [10, 1]);
  await client.query("ROLLBACK");
  await client.query("BEGIN");
  const updated = await client.query("UPDATE rt SET score = score + $1 WHERE id = $2", [10, 2]);
  await client.query("COMMIT");
  console.log("update", updated.rowCount);
  const after = await client.query("SELECT id, score FROM rt ORDER BY id");
  console.log("after", JSON.stringify(after.rows));
  try {
    await client.query("INSERT INTO rt (id, name) VALUES ($1, $2)", [1, "dup"]);
  } catch (e) {
    const err = e as { code?: string; message: string };
    console.log("error", err.code, err.message);
  }
  await client.query("DROP TABLE rt");
  await client.end();
  console.log("closed");
}
main().catch((e) => console.log("failed", (e as Error).message));
