// A field assigned from a parameter defaulted to {}: a guarded read and call
// must see the member the caller passed (a record would drop it silently).
class P {
  constructor(hooks = {}) { this.hooks = hooks; }
  go(r) { if (this.hooks.onCreate) this.hooks.onCreate(r); return 1; }
}
const p = new P({ onCreate: (x) => console.log("c", x) });
console.log(p.go(1));
new P().go(2);
