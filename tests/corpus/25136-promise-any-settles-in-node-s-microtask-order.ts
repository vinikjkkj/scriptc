// Promise.any: the first fulfillment wins, in the microtask order Node gives (already-settled entries, rejected-then-fulfilled, all rejected, timers, an empty
// iterable, plain values, awaited). It had no lowering at all (SC2020).
const log: string[] = [];
function mark(s: string): void { log.push(s); console.log(s); }
function delayed(v: number, ms: number): Promise<number> { return new Promise<number>((r) => setTimeout(() => r(v), ms)); }
function delayedFail(ms: number, why: string): Promise<number> { return new Promise<number>((_r, rej) => setTimeout(() => rej(new Error(why)), ms)); }

// already-settled entries with interleaved microtask chains
const a: Promise<number> = Promise.resolve(1);
const b: Promise<number> = Promise.resolve(2);
Promise.any([a, b]).then((v) => mark("any1 " + v));
a.then(() => mark("a.then1")).then(() => mark("a.then2")).then(() => mark("a.then3"));
b.then(() => mark("b.then1"));
Promise.resolve().then(() => mark("p0")).then(() => mark("p1")).then(() => mark("p2")).then(() => mark("p3"));

// rejected first, fulfilled second
const r1: Promise<number> = Promise.reject(new Error("r1"));
const v1: Promise<number> = Promise.resolve(10);
Promise.any([r1, v1]).then((v) => mark("any2 " + v));
r1.catch(() => mark("r1.catch"));

// all rejected
const x1: Promise<number> = Promise.reject(new Error("x1"));
const x2: Promise<number> = Promise.reject(new Error("x2"));
Promise.any([x1, x2]).catch((e) => mark("any3 " + String(e)));
x1.catch(() => mark("x1.catch"));
x2.catch(() => mark("x2.catch"));

// pending entries (timers) and microtasks
Promise.any([delayed(1, 5), delayed(2, 1)]).then((v) => mark("any4 " + v));
Promise.any([delayedFail(1, "late1"), delayed(3, 4)]).then((v) => mark("any5 " + v));
Promise.any([delayedFail(1, "e1"), delayedFail(2, "e2")]).catch((e) => mark("any6 " + String(e)));
Promise.any([] as number[]).catch((e) => mark("any7 " + String(e)));
Promise.any([42]).then((v) => mark("any8 " + v));
Promise.any([Promise.resolve(1), 2]).then((v) => mark("any9 " + v));

async function viaAwait(): Promise<void> {
  const v = await Promise.any([Promise.resolve(5)]);
  mark("await any " + v);
  try { await Promise.any([Promise.reject(new Error("q"))]); } catch (e) { mark("await catch " + String(e)); }
}
viaAwait();
queueMicrotask(() => mark("micro1"));
process.nextTick(() => mark("tick"));
mark("sync end");
