// Inspect and typeof of a record carrying a rest-any function member and a PromiseConstructorLike
// member: Node prints `[Function: name]` for the closure and `[Function: Promise]` for the
// global Promise, at every depth, and an absent member is simply not printed.
interface PoolOpts {
  host?: string;
  max?: number;
  log?: ((...messages: any[]) => void) | undefined;
  Promise?: PromiseConstructorLike | undefined;
}
function sink(...messages: any[]): void { void messages; }
const a: PoolOpts = { host: "h", max: 2, log: sink, Promise: Promise };
const b: PoolOpts = { host: "g" };
const c: PoolOpts = { log: (...m: any[]) => void m.length };
console.log(a);
console.log(b);
console.log(c);
console.log(typeof a.log, typeof a.Promise, a.Promise === Promise, a.Promise === undefined, b.Promise === undefined);
