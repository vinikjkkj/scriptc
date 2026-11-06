// A field an instance holds as undefined is an own enumerable key: for-in visits it (the value test drops only absent keys).
class C { constructor() { this.tag = "t"; } }
C.prototype.call = "dflt";
function store(o, v) { o.call = v; }
function keys(e) { const out = []; for (const k in e) out.push(k); return out.join(); }
const u = new C(); store(u, undefined);
console.log(keys(u));
class D { constructor() { this.tag = "t"; this.zz = undefined; } }
console.log(keys(new D()));
