// The program asserts through `unknown` that a client has a callable member and calls it (zapo's redis stores reach ioredis' mset and evalBuffer this way, with a spread):
// the call must run the member the client really has, on the client, with the arguments as separate values.
import { Redis } from "expclass";
async function main(): Promise<void> {
  const r = new Redis({ host: "h" });
  const keys: (string | Buffer)[] = ["a", "b", "c"];
  const n = (r as unknown as { del: (...args: unknown[]) => number }).del(...keys);
  const m = (r as unknown as { mget: (...args: unknown[]) => number }).mget("x", "y");
  const g = (r as unknown as { get: (key: string) => string }).get("k");
  console.log(n, m, g, r.calls);
}
main();
