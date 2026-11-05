class K {
  *inner(): Generator<number, void, undefined> {
    try { yield 1; yield 2; } catch (e) { console.log("inner caught", (e as Error).message); yield 100; yield 101; } finally { console.log("inner finally"); }
  }
  *outer(): Generator<number, void, undefined> { try { yield* this.inner(); yield 3; } finally { console.log("outer finally"); } }
  *plain(): Generator<number, void, undefined> { try { yield 1; } finally { console.log("plain finally"); } }
  *outer2(): Generator<number, void, undefined> { try { yield* this.plain(); } finally { console.log("outer2 finally"); } }
  *cleaner(): Generator<number, void, undefined> { try { yield 1; yield 2; } finally { console.log("cleaner finally"); yield 77; console.log("cleaner end"); } }
  *outer3(): Generator<number, void, undefined> { try { yield* this.cleaner(); } finally { console.log("outer3 finally"); } }
}
const k = new K();
const g = k.outer();
console.log(g.next().value);
const t = g.throw(new Error("E1")); console.log(t.value, t.done);
console.log(g.next().value);
console.log(g.next().value);
const e = g.next(); console.log(e.value, e.done);
const g2 = k.outer2(); g2.next();
try { g2.throw(new Error("E2")); } catch (x) { console.log("propagated", (x as Error).message); }
console.log(g2.next().done);
const g3 = k.outer3(); g3.next();
const r1 = g3.return(); console.log("ret", r1.value, r1.done);
const r2 = g3.next(); console.log("after", r2.value, r2.done);
