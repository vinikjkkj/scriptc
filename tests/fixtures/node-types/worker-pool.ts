// The worker pool under REAL @types/node: the promisified forms zapo uses
// (util.promisify over randomBytes, randomInt, pbkdf2 and zlib), which the
// shipped fallback declarations do not carry, so the corpus cannot reach them.
//
// Node resolves these promises in the poll phase, after the synchronous run,
// the nextTick queue and the promise jobs; they were born already settled
// here before the pool. Pinned (all independent of threadpool timing):
//  - the order sync, microtask, tick, then the awaited result;
//  - argument errors REJECT the promise (they never throw out of the call);
//  - 150 concurrent requests all resolve with the right shape;
//  - concurrent pbkdf2 derivations resolve to their deterministic values;
//  - zlib round trips through the pool.
// Random bytes are never printed.
import { randomBytes, randomInt, pbkdf2 } from "node:crypto";
import { deflate, unzip } from "node:zlib";
import { promisify } from "node:util";

const rb = promisify(randomBytes) as (n: number) => Promise<Buffer>;
const ri = promisify(randomInt) as (a: number, b: number) => Promise<number>;
const pb = promisify(pbkdf2) as (p: Uint8Array, s: Uint8Array, i: number, k: number, d: string) => Promise<Buffer>;
const deflateAsync = promisify(deflate) as (b: Uint8Array) => Promise<Buffer>;
const unzipAsync = promisify(unzip) as (b: Uint8Array) => Promise<Buffer>;

const log: string[] = [];
const n = (s: string): void => {
  log.push(s);
};

async function main(): Promise<void> {
  const p1 = rb(16).then((b) => n("rb16 " + b.length + " " + Buffer.isBuffer(b)));
  process.nextTick(() => n("tick"));
  Promise.resolve().then(() => n("micro"));
  n("sync");
  await p1;
  n("after-p1");
  const v = await ri(10, 20);
  n("ri " + (v >= 10 && v < 20));
  const k = await pb(Buffer.from("pw"), Buffer.from("salt"), 1000, 32, "sha256");
  n("pb " + k.length + " " + k.toString("hex"));
  try {
    await rb(-1);
    n("no-throw");
  } catch (e) {
    n("rb err " + (e as Error).message);
  }
  try {
    await ri(5, 5);
    n("no-throw");
  } catch (e) {
    n("ri err " + (e as Error).message);
  }
  const all = await Promise.all(Array.from({ length: 150 }, (_, i) => rb(i + 1)));
  let ok = 0;
  for (let i = 0; i < all.length; i++) if (all[i]!.length === i + 1) ok++;
  n("150 ok " + ok);
  const ks = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => pb(Buffer.from("pw" + i), Buffer.from("s"), 2000, 16, "sha256")));
  n(ks.map((x) => x.toString("hex").slice(0, 8)).join(","));
  const src = Buffer.from("zlib through the pool ".repeat(200));
  const z = await deflateAsync(src);
  const back = await unzipAsync(z);
  n("zlib " + (z.length < src.length) + " " + back.equals(src));
  try {
    await unzipAsync(Buffer.from("not a zlib stream"));
    n("no-throw");
  } catch (e) {
    const err = e as Error & { code?: string; errno?: number };
    n("unzip err " + err.code + " " + err.errno + " " + err.message);
  }
}
setTimeout(() => n("timer20"), 20);
main().then(() => {
  setTimeout(() => {
    console.log(log.join("\n"));
  }, 40);
});
