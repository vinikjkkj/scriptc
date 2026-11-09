import { Redis } from "ioredis";

// The round trip against a real server (the workflow's redis service): connect with its status events, string commands with a TTL, multi-key reads
// (strings and buffers), a pipeline, a MULTI transaction, a pub/sub round trip, quit. Every printed line is compared with Node's.
async function main(): Promise<void> {
  const r = new Redis({ host: "127.0.0.1", port: 6379, lazyConnect: true, maxRetriesPerRequest: 1 });
  const events: string[] = [];
  r.on("connect", () => events.push("connect"));
  r.on("ready", () => events.push("ready"));
  await r.connect();
  console.log("status", r.status);
  await r.del("rt:a", "rt:b", "rt:c", "rt:h", "rt:s");
  console.log("set", await r.set("rt:a", "1"), await r.set("rt:b", "two", "EX", 60));
  console.log("get", await r.get("rt:a"), await r.get("rt:b"), await r.get("rt:none"));
  const ttl = await r.ttl("rt:b");
  console.log("ttl", ttl > 0 && ttl <= 60);
  console.log("mget", JSON.stringify(await r.mget("rt:a", "rt:b", "rt:none")));
  const mb = await r.mgetBuffer("rt:a", "rt:none");
  console.log("mgetBuffer", mb.length, mb[0] !== null && mb[0].toString("utf8"), mb[1]);
  const p = r.pipeline();
  p.set("rt:c", "3");
  p.get("rt:c");
  p.hset("rt:h", "f", "v");
  p.hgetall("rt:h");
  p.sadd("rt:s", "x", "y");
  p.scard("rt:s");
  const pipe = await p.exec();
  console.log("pipeline", JSON.stringify(pipe));
  const m = r.multi();
  m.incr("rt:n");
  m.incr("rt:n");
  m.get("rt:n");
  const multi = await m.exec();
  console.log("multi", JSON.stringify(multi));
  const sub = new Redis({ host: "127.0.0.1", port: 6379 });
  const got: string[] = [];
  await sub.subscribe("rt:chan");
  sub.on("message", (channel: string, message: string) => got.push(channel + "=" + message));
  await r.publish("rt:chan", "hello");
  for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  console.log("pubsub", JSON.stringify(got));
  console.log("del", await r.del("rt:a", "rt:b", "rt:c", "rt:h", "rt:s", "rt:n"));
  sub.disconnect();
  await r.quit();
  console.log("events", events.join(","));
}
main().catch((e) => console.log("failed", (e as Error).message));
