// The payload's record is a VIEW of the class instance, so a program that WRITES a field of that record
// writes the instance's own member, as in Node.
import { createPool } from "twinrec/promise";
import type { Pool, ResultSetHeader } from "twinrec/promise";
async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const [hdr] = await pool.execute<ResultSetHeader>("INSERT INTO t", [1]);
  hdr.affectedRows = 7;
  console.log(hdr.affectedRows);
}
void main();
