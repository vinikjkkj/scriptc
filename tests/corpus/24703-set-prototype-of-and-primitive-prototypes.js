function Base(a) { this.a = a; }
Base.prototype.get = function () { return this.a; };
function Derived(a, b) { Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Derived.prototype, Base.prototype);
const d = new Derived(1, 2);
console.log(d.get(), d instanceof Base, d instanceof Derived, Object.getPrototypeOf(Derived.prototype) === Base.prototype);
const o = { x: 1 };
const r = Object.setPrototypeOf(o, Base.prototype);
console.log(r === o, o instanceof Base, Object.getPrototypeOf(o) === Base.prototype);
console.log(Object.setPrototypeOf(5, Base.prototype), Object.setPrototypeOf("s", null));
try { Object.setPrototypeOf({}, 5); } catch (e) { console.log(e.constructor.name, e.message); }
try { Object.setPrototypeOf(null, {}); } catch (e) { console.log(e.constructor.name, e.message); }
try { Object.setPrototypeOf(Base.prototype, d); } catch (e) { console.log(e.constructor.name, e.message); }
const bare = Object.setPrototypeOf({ k: 1 }, null);
console.log(Object.getPrototypeOf(bare), Object.keys(bare));
console.log(Object.getPrototypeOf("s") === String.prototype, Object.getPrototypeOf(1) === Number.prototype, Object.getPrototypeOf(true) === Boolean.prototype);
console.log(String.prototype === String.prototype, String.prototype !== Number.prototype, Object.getPrototypeOf(String.prototype) === Object.prototype);
const w = Object("hello");
console.log(Object.getPrototypeOf(w) === String.prototype, Object.prototype.toString.call(w), Object.prototype.toString.call(Object(5)));
for (const k in w) console.log("k", k);
console.log([...w].join("|"), Object.hasOwn(w, "1"), Object.hasOwn(w, "length"));
