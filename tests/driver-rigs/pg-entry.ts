import { createPostgresStore } from "@zapo-js/store-postgres";

async function main(): Promise<void> {
  const store = createPostgresStore({ pool: { host: "127.0.0.1", port: 5432, user: "u", password: "p", database: "d", max: 2 }, tablePrefix: "t_" });
  console.log(Object.keys(store.stores).length);
  console.log(typeof store.caches);
  await store.destroy();
}
main().catch((e) => console.log("failed", (e as Error).message));
