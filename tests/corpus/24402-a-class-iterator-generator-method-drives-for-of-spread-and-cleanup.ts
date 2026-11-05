class Tree {
  kids: Tree[] = [];
  v: number; constructor(v: number) { this.v = v; }
  *walk(): Generator<number> { yield this.v; for (const k of this.kids) yield* k.walk(); }
  *[Symbol.iterator](): Generator<number> { yield* this.walk(); }
}
const t = new Tree(1); t.kids.push(new Tree(2), new Tree(3)); t.kids[0]!.kids.push(new Tree(4));
for (const v of t) console.log("w", v);
function firstOver(t: Tree, n: number): number | undefined { for (const v of t) { if (v > n) return v; } return undefined; }
console.log(firstOver(t, 2));
class Boom {
  *[Symbol.iterator](): Generator<number> { try { yield 1; yield 2; throw new Error("inside"); } finally { console.log("boom-finally"); } }
}
try { for (const v of new Boom()) console.log("b", v); } catch (e) { console.log("caught", (e as Error).message); }
try { for (const v of new Boom()) { console.log("b2", v); throw new Error("consumer"); } } catch (e) { console.log("caught", (e as Error).message); }
class Base2 { *[Symbol.iterator](): Generator<string> { yield "base"; } }
class Sub2 extends Base2 { *[Symbol.iterator](): Generator<string> { yield "sub1"; yield "sub2"; } }
function show(b: Base2) { for (const s of b) console.log(s); }
show(new Base2()); show(new Sub2());
const xs: string[] = [...new Sub2(), ...new Base2()];
console.log(xs.join("|"));
function many(...a: string[]) { return a.length; }
console.log(many(...new Sub2(), "z"));
