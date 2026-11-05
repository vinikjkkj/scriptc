class Base {
  *items(n: number): Generator<number, number> { for (let i = 0; i < n; i++) yield i * 2; return 99; }
  inherited(): Generator<string> { return this.names(); }
  *names(): Generator<string> { yield "base-a"; yield "base-b"; }
}
class Sub extends Base {
  *items(n: number): Generator<number, number> { try { for (let i = 0; i < n; i++) yield i * 3; } finally { console.log("sub-finally"); } return 7; }
}
function run(b: Base) { const out: number[] = []; for (const v of b.items(4)) out.push(v); console.log(out.join(",")); }
run(new Base()); run(new Sub());
for (const s of new Sub().inherited()) console.log(s);
const sub: Base = new Sub();
for (const v of sub.items(10)) { if (v > 3) break; console.log("v", v); }
const it = new Base().items(2); for (let k = 0; k < 3; k++) { const r = it.next(); console.log(r.value, r.done); }
const g = new Sub().items(5); { const r = g.next(); console.log(r.value, r.done); } try { g.throw(new Error("boom")); } catch (e) { console.log("caught", (e as Error).message); }
