import { createRedisStore } from "@zapo-js/store-redis";

async function main(): Promise<void> {
  const store = createRedisStore({
    redis: { host: "127.0.0.1", port: 6379, lazyConnect: true, maxRetriesPerRequest: 1 },
    keyPrefix: "t:",
    cacheTtlMs: { retryMs: 1000, groupMetadataMs: 1000, chatMetadataMs: 1000, deviceListMs: 1000, messageSecretMs: 1000 },
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
  console.log(n);
  await store.destroy();
}
main().catch((e) => console.log("failed", (e as Error).message));
