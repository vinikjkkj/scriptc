// A declaration-file class with a generic, overloaded `execute` from a mixin
// (mysql2's Pool), produced by the package's own class (PromisePool).
import mysql from "mixinpool/promise";
import type { Pool } from "mixinpool/promise";

class Store {
  private pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async get(sql: string): Promise<string> {
    const [rows, fields] = await this.pool.execute<string>(sql, [1, 2]);
    return `${rows}/${fields.length}`;
  }
}

async function main(): Promise<void> {
  const pool = mysql.createPool("a");
  const store = new Store(pool);
  console.log(await store.get("SELECT"));
  console.log(await store.get("SELECT 2"));
  console.log(pool.count());
  try {
    await store.get("boom");
  } catch (e) {
    console.log((e as Error).message);
  }
}
main();
