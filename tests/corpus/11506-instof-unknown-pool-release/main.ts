// The promise/pool shape: a method takes an untyped connection and releases it only
// when it is the imported PoolConnection class (a plain object and a foreign class do not).
import { PoolConnection, Other } from "./conn.ts";

class Pool {
  releaseConnection(connection: unknown): string {
    if (connection instanceof PoolConnection) {
      connection.release();
      return "released " + connection.released;
    }
    return "kept";
  }
}
const pool = new Pool();
const p = new PoolConnection();
console.log(pool.releaseConnection(p));
console.log(pool.releaseConnection(p));
console.log(pool.releaseConnection(new Other()));
console.log(pool.releaseConnection({ released: 0 }));
console.log(pool.releaseConnection(undefined));
