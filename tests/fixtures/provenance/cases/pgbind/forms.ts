import pg from "pgbind";
import { Forms } from "pgstore/forms";
const pool = new pg.Pool({ max: 2 });
new Forms(pool).go().then(
  () => console.log("done"),
  (e) => console.log("ERR", (e as Error).message)
);
