// for-in visits inherited enumerable properties: a constructor prototype, shadowing, and a two-level chain
function Base() { this.own = 1; }
Base.prototype.alpha = "a";
Base.prototype.beta = "b";
function Derived() { Base.call(this); this.mine = 2; }
Derived.prototype = Object.create(Base.prototype);
Derived.prototype.gamma = "g";
Derived.prototype.alpha = "shadowed-by-derived-proto";
const d = new Derived();
d.beta = "own-beta";
const seen = [];
for (const k in d) seen.push(k + "=" + d[k]);
console.log(seen.join(" "));
// a non-enumerable own property shadows an enumerable inherited one
function P() {}
P.prototype.hidden = "inherited";
P.prototype.shown = "inherited";
const p = new P();
Object.defineProperty(p, "hidden", { value: "own", enumerable: false });
const s2 = [];
for (const k in p) s2.push(k);
console.log(s2.join(","));
