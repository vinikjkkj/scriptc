// The result of a declared generic, overloaded `execute` whose payload holds RECORD arms: the twin
// answers a ResultSetHeader class instance for a write and a string for a read, and the declared
// payload is read the way mysql2's store reads it. The checked cast takes the instance's members
// (own data fields here, getters and methods in corpus 23950) and the union arm the value fits.
import { createPool } from "twinrec/promise";
import type { Pool, PoolConnection, ResultSetHeader } from "twinrec/promise";

async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const [hdr, f] = await pool.execute<ResultSetHeader>("INSERT INTO t", [1]);
  console.log("header", hdr.affectedRows, hdr.insertId, f.length);
  const [any, g] = await pool.execute("INSERT INTO u");
  if (typeof any === "string") console.log("text", any, g.length);
  else if (Array.isArray(any)) console.log("rows", any.length);
  else console.log("union header", any.affectedRows, any.insertId);
  const [text] = await pool.execute("SELECT 1", [1, 2]);
  if (typeof text === "string") console.log("text", text);
  else console.log("other");
  const conn: PoolConnection = await pool.getConnection();
  const [fromConn] = await conn.execute<ResultSetHeader>("INSERT INTO v");
  console.log("conn header", fromConn.affectedRows, fromConn.insertId);
  conn.release();
  await pool.end();
  console.log("ended");
}
void main();
