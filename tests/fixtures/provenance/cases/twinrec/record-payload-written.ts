// The payload's record is read off a class instance as a COPY, so a program that WRITES a field of
// that record shape keeps a compile-time refusal (Node's one object would show the write to the
// instance's holder).
import { createPool } from "twinrec/promise";
import type { Pool, ResultSetHeader } from "twinrec/promise";
async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const [hdr] = await pool.execute<ResultSetHeader>("INSERT INTO t", [1]);
  hdr.affectedRows = 7;
  console.log(hdr.affectedRows);
}
void main();
