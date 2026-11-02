import { createMysqlStore, createMysqlPool } from "@zapo-js/store-mysql";

async function main(): Promise<void> {
  const pool = createMysqlPool({
    host: "127.0.0.1",
    port: 3306,
    user: "u",
    password: "p",
    database: "d",
    connectionLimit: 2,
    waitForConnections: true,
  });
  const store = createMysqlStore({ pool, tablePrefix: "t_" });
  console.log(Object.keys(store.stores).length);
  await store.destroy();
}
main().catch((e) => console.log("failed", (e as Error).message));
