// zapo's deliverHistoryItem: a sink's `void | Promise<void>` result goes through `Promise.resolve` once it is known to be thenable. The promise arm comes back as itself
// (Promise.resolve(p) === p), the undefined arm becomes an already-settled promise, and the two are awaited in order.
type Sink = (i: number) => Promise<void> | void;
const log: string[] = [];
const sync: Sink = (i) => { log.push("sync" + i); };
const later: Sink = (i) => new Promise<void>((resolve) => { log.push("later" + i); resolve(); });
let kept: Promise<void> | undefined;
const holder: Sink = (i) => { kept = Promise.resolve(); log.push("hold" + i); return kept; };
function deliver(sink: Sink, i: number): Promise<void> | undefined {
  const result = sink(i);
  return typeof (result as PromiseLike<void> | undefined)?.then === "function" ? Promise.resolve(result) : undefined;
}
async function main(): Promise<void> {
  const a = deliver(sync, 1);
  const b = deliver(later, 2);
  const c = deliver(holder, 3);
  console.log(a === undefined, b !== undefined, c === kept);
  await b;
  await c;
  const direct = Promise.resolve(kept);
  console.log(direct === kept, log.join(","));
}
main();
