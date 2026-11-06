class Base {
  *items(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i * 2; return "done:" + n; }
  *more(): Generator<number> { yield* this.items(2); yield 100; return "m"; }
}
class Sub extends Base {
  *items(n: number): Generator<number> { yield n; return { sub: true, n }; }
}
function run(b: Base) {
  const g = b.items(2);
  let r = g.next();
  while (!r.done) { console.log("v", r.value); r = g.next(); }
  console.log("ret", r.value);
}
run(new Base()); run(new Sub());
for (const v of new Sub().items(3)) console.log("each", v + 1);
class Bag { *[Symbol.iterator](): Generator<string> { yield "p"; yield "q"; return 7; } }
const out: string[] = [...new Bag()]; console.log(out.join(","));
for (const s of new Bag()) console.log(s.toUpperCase());
function* plain(): Generator<boolean, void, undefined> { yield true; }
for (const b of plain()) console.log(b);
function* outer(): Generator<number> { yield* new Base().items(2); return 5; }
const o = outer(); console.log(o.next().value, o.next().value, o.next().value, o.next().done);
async function* ag(): AsyncGenerator<number> { yield 1; return "agdone"; }
async function main() {
  const a = ag();
  console.log((await a.next()).value, await a.next());
  for await (const x of ag()) console.log("fa", x + 1);
}
main();
function* ungated(): Generator<string> { yield "u1"; yield "u2"; }
for (const u of ungated()) console.log(u);
const ig: IterableIterator<number> = new Sub().items(4);
for (const z of ig) console.log("ig", z);
