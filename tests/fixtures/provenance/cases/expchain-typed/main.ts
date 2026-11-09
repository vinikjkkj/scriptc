// A package whose pipeline() is a prototype-assigned function returning a class instance, declared as an intersection of a generic command interface and
// exec (ioredis' ChainableCommander): the typed program calls commands on the returned value, and stringifies what exec resolves.
import { Redis } from "expchain";
async function main(): Promise<void> {
  const r = new Redis({ host: "h" });
  const p = r.pipeline();
  p.set("a", "1");
  p.get("a");
  p.hset("h", "f", "v");
  p.del("a", "b");
  console.log(p.length);
  const out = await p.exec();
  console.log(JSON.stringify(out));
  const m = r.multi();
  m.incr("n");
  m.get("n");
  console.log(JSON.stringify(await m.exec()));
  console.log(out === null ? "null" : out.length, await r.get("k"), r.sent);
}
main();
