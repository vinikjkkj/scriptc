// A package command that answers a promise of buffers and nulls (ioredis' mgetBuffer), reached through the instance and spread over its keys: the store maps each
// buffer into a Uint8Array, and null stays null.
import { Redis } from "expclass";
async function main(): Promise<void> {
  const r = new Redis({ host: "h" });
  const keys = ["a", "none", "c"];
  const values = await r.mgetBuffer(...keys);
  const out = values.map((data) => (data ? new Uint8Array(data) : null));
  console.log(out.length, out[0] instanceof Uint8Array, out[1] === null, Array.from(out[2]!).join(","), r.calls);
}
main();
