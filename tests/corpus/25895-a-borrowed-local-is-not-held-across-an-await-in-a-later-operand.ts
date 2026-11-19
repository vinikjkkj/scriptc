// With an await among the later operands the receiver is NOT borrowed (a stackless coroutine spills only owned temps); the value at the read must survive the park even when another task reassigns the variable.
let shared = "initial";
async function other(): Promise<number> { shared = "replaced"; return 1; }
async function readAcrossAwait(): Promise<string> {
  let s = "kept-value";
  const r = s.indexOf("v") + (await other());
  const t = s.charCodeAt(0) + (await other()) + s.length;
  const arr = [s, "b"];
  const u = arr[await other()];
  return r + ":" + t + ":" + u + ":" + shared;
}
function* gen(): Generator<number, string, number> {
  let s = "gen";
  const a = s.length + (yield 1);
  const b = s.charCodeAt(1) + (yield 2);
  return a + ":" + b + ":" + s;
}
async function main(): Promise<void> {
  console.log(await readAcrossAwait());
  const g = gen();
  g.next(0);
  g.next(10);
  console.log(g.next(20).value);
}
main();
