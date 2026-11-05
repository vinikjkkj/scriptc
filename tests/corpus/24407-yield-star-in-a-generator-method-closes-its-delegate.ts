class T {
  *inner(): Generator<number> { try { yield 1; yield 2; yield 3; } finally { console.log("inner-finally"); } }
  *outer(): Generator<number> { try { yield 0; yield* this.inner(); yield 9; } finally { console.log("outer-finally"); } }
}
function first(): number | undefined { for (const v of new T().outer()) { if (v > 1) return v; } return undefined; }
console.log(first());
for (const v of new T().outer()) { if (v === 1) break; }
for (const v of new T().outer()) console.log("all", v);
