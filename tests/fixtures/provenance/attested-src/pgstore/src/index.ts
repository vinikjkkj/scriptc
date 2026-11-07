import type { Pool, PoolClient } from "pgbind";
export class PgStore {
  constructor(private readonly pool: Pool) {}
  async run(): Promise<string> {
    const runChunk = async (executor: { query: PoolClient["query"] }): Promise<string> => {
      const r = await executor.query({ name: "n", text: "x", values: [1] });
      return String(r.rows[0]);
    };
    return await runChunk(this.pool);
  }
}
