// Prototype data under a name the program also stores values to through untyped code (which may be undefined): an own undefined hides the datum, delete re-exposes it, and hasOwn, for-in, JSON, inspect and typed reads agree.
class Commander { constructor() { this.tag = "t"; } }
Commander.prototype.call = "dflt";
function store(o, v) { o.call = v; }
const fresh = new Commander(), own = new Commander(), undef = new Commander(), gone = new Commander();
store(own, "own");
store(undef, undefined);
store(gone, "tmp");
function drop(e) { delete e.call; return e; }
drop(gone);
const rows = [fresh, own, undef, gone, { call: 1 }, {}];
function read(e) { return e.call; }
function key(e, k) { return e[k]; }
function has(e) { return Object.hasOwnProperty.call(e, "call"); }
function keys(e) { const out = []; for (const k in e) out.push(k); return out.join(); }
function json(e) { return JSON.stringify(e); }
function showv(v) { return v === undefined ? "<undefined>" : String(v); }
for (const e of rows) console.log(showv(read(e)), showv(key(e, "call")), has(e), keys(e), json(e));
console.log(fresh, own, undef, gone);
console.log(fresh.call, own.call, undef.call, gone.call);
console.log(fresh.hasOwnProperty("call"), own.hasOwnProperty("call"), undef.hasOwnProperty("call"), gone.hasOwnProperty("call"));
