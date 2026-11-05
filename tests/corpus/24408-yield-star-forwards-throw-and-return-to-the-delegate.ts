function* inner(): Generator<number, void, undefined> {
  try { yield 1; yield 2; } catch (e) { console.log("inner caught", (e as Error).message); yield 100; yield 101; } finally { console.log("inner finally"); }
}
function* outer(): Generator<number, void, undefined> { try { yield* inner(); yield 3; } finally { console.log("outer finally"); } }
const g = outer();
console.log(g.next().value);
const t = g.throw(new Error("E1")); console.log(t.value, t.done);
console.log(g.next().value);
console.log(g.next().value);
const e = g.next(); console.log(e.value, e.done);
function* plain(): Generator<number, void, undefined> { try { yield 1; } finally { console.log("plain finally"); } }
function* outer2(): Generator<number, void, undefined> { try { yield* plain(); } finally { console.log("outer2 finally"); } }
const g2 = outer2(); g2.next();
try { g2.throw(new Error("E2")); } catch (x) { console.log("propagated", (x as Error).message); }
console.log(g2.next().done);
function* cleaner(): Generator<number, void, undefined> { try { yield 1; yield 2; } finally { console.log("cleaner finally"); yield 77; console.log("cleaner end"); } }
function* outer3(): Generator<number, void, undefined> { try { yield* cleaner(); } finally { console.log("outer3 finally"); } }
const g3 = outer3(); g3.next();
const r1 = g3.return(); console.log("ret", r1.value, r1.done);
const r2 = g3.next(); console.log("after", r2.value, r2.done);
function* outer5(): Generator<number, void, undefined> { try { yield* plain(); } catch (e) { console.log("outer5 caught", (e as Error).message); yield 9; } }
const g5 = outer5(); g5.next(); const r5 = g5.throw(new Error("E5")); console.log(r5.value, r5.done); console.log(g5.next().done);
for (const v of outer()) { if (v === 100) break; }
