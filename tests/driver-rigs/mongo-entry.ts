import { createMongoStore } from "@zapo-js/store-mongo";

async function main(): Promise<void> {
  const store = createMongoStore({
    db: {
      uri: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100",
      database: "wa",
      options: { maxPoolSize: 2, appName: "mongorig" },
    },
    collectionPrefix: "t_",
    cacheTtlMs: { retryMs: 1000, groupMetadataMs: 1000, chatMetadataMs: 1000, deviceListMs: 1000, messageSecretMs: 1000 },
    slowOperationThresholdMs: 250,
  });
  const sid = "s1";
  let n = 0;
  for (const k of Object.keys(store.stores)) {
    const f = (store.stores as Record<string, (s: string) => object>)[k];
    if (f(sid)) n++;
  }
  for (const k of Object.keys(store.caches)) {
    const f = (store.caches as Record<string, (s: string) => object>)[k];
    if (f(sid)) n++;
  }
  console.log(n, store.db.databaseName);
  await store.destroy();
}
main().catch((e) => console.log("failed", (e as Error).message));
