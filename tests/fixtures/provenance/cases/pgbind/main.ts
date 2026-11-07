// pg's executor shape: a store (its own package, as zapo's store-postgres is) hands a package-class pool to an async arrow typed
// `{ query: PoolClient['query'] }`. The record's method must keep the pool as its receiver (Node: `this` is the pool).
import pg from "pgbind";
import { PgStore } from "pgstore";
const pool = new pg.Pool({ max: 2 });
new PgStore(pool).run().then(
  (r) => console.log(r),
  (e) => console.log("ERR", (e as Error).message)
);
