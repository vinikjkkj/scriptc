// A class built by `new Function` over text the compiler cannot fold lives in the
// embedded engine; `new` over a call that returns it constructs in the engine.
"use strict";
function mk(src) { return new Function("return (" + src + ")")(); }
function get(n) { return mk("class A { constructor(x){ this.x = x; } next(){ return this.x * " + n + "; } }"); }
const cache = new Map();
function getCached(n) { let p = cache.get(n); if (!p) { p = get(n); cache.set(n, p); } return p; }
const r = new (getCached(2))(3);
console.log(r.next());
class Q { constructor(f) { this.f = f; } run() { const P = getCached(3); const o = new (P)(this.f); return o.next(); } }
console.log(new Q(5).run());
