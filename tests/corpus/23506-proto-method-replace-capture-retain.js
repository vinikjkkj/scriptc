// The replacement captures objects (retained by the slot), is replaced repeatedly (each previous one released), and is read back.
class Counter {
  constructor() { this.n = 0; }
  bump() { this.n += 1; return this.n; }
}
function makeBump(state) {
  return function () { state.calls.push(this.n);  return state.calls.length * state.step; };
}
const c = new Counter();
console.log(c.bump());
const s1 = { calls: [], step: 10, big: new Array(64).fill("x").join("") };
Counter.prototype.bump = makeBump(s1);
console.log(c.bump(), c.bump(), s1.calls.join(","));
const s2 = { calls: [], step: 100 };
const f2 = makeBump(s2);
Counter.prototype.bump = f2;
console.log(c.bump(), s2.calls.join(","), Counter.prototype.bump === f2, c.bump === f2);
for (let i = 0; i < 50; i++) Counter.prototype.bump = makeBump({ calls: [], step: i });
console.log(new Counter().bump(), new Counter().bump());
