// The order in which an async generator's yields, awaits and its consumer's loop interleave with an independent microtask chain: every line is
// tagged so a one-turn difference shows up as a reordered line.
const log: string[] = [];
const tick = (tag: string): void => { log.push(tag); };
let n = 0;
function chain(): void {
  Promise.resolve().then(() => { tick("m1"); }).then(() => { tick("m2"); }).then(() => { tick("m3"); }).then(() => { tick("m4"); }).then(() => { tick("m5"); });
}
async function* inner(tag: string): AsyncGenerator<number, string, void> {
  tick(`${tag}:start`);
  yield 1;
  tick(`${tag}:after1`);
  await Promise.resolve();
  tick(`${tag}:awaited`);
  yield 2;
  tick(`${tag}:after2`);
  await null;
  await null;
  yield 3;
  tick(`${tag}:end`);
  return `${tag}:done`;
}
async function* outer(): AsyncGenerator<number, void, void> {
  for await (const v of inner("a")) {
    tick(`outer:got${v}`);
    yield v * 10;
  }
  for await (const v of inner("b")) yield v + 100;
  tick("outer:end");
}
async function main(): Promise<void> {
  chain();
  const it = outer();
  for await (const v of it) {
    tick(`main:${v}`);
    n += v;
  }
  tick(`total:${n}`);
  chain();
  const g = inner("c");
  const a = await g.next();
  tick(`next1:${a.value}:${a.done}`);
  const b = await g.next();
  tick(`next2:${b.value}:${b.done}`);
  const c = await g.next();
  const d = await g.next();
  tick(`next34:${c.value}:${d.done}:${d.value}`);
  const e = await g.next();
  tick(`next5:${e.value}:${e.done}`);
  console.log(log.join("\n"));
}
main();
