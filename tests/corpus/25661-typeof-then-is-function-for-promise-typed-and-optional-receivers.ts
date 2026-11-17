// The thenable test `typeof x?.then === "function"` over a Promise, a PromiseLike, an optional receiver and a cast of a void-or-promise result. The members of a
// Promise are its methods, so the answer needs no bound value; an optional chain over a missing receiver is "undefined".
function sink(i: number): Promise<number> | void { return i % 2 === 0 ? Promise.resolve(i) : undefined; }
function deliver(i: number): Promise<number> | undefined {
  const result = sink(i);
  return typeof (result as PromiseLike<number> | undefined)?.then === "function" ? Promise.resolve(result as Promise<number>) : undefined;
}
function isThenable(p: PromiseLike<void> | undefined): string { return typeof p?.then + "|" + (typeof p?.then === "function"); }
function direct(p: Promise<string>): string { return typeof p.then + "," + typeof p.catch + "," + typeof p.finally; }
async function main(): Promise<void> {
  const a = deliver(2);
  const b = deliver(3);
  console.log(a !== undefined, b === undefined, await a);
  console.log(isThenable(Promise.resolve()), isThenable(undefined));
  console.log(direct(Promise.resolve("x")));
}
main();
