// Anonymous and named evaluated classes in dyn: static fields and writes through the value, expando
// properties added to the class value, enumerable keys and inspect (`[class X extends Y] { ... }`,
// `[class (anonymous)]`), `in`, hasOwn, and the call-without-new TypeError.
function anyv(x) { return x; }
class Base { constructor(n) { this.n = n; } }
const mkAnon = (k) => class { constructor() { this.k = k; } static tag = "anon"; };
const mkNamed = (k) => class Named extends Base { static hits = 0; static note = "n" + k; constructor(n) { super(n); Named.hits++; this.k = k; } };
const bag = {};
bag.anon = mkAnon(1);
bag.named = mkNamed(2);
const Anon = anyv(bag.anon), Named = anyv(bag.named);
console.log(Anon.name === "", Named.name, typeof Anon, typeof Named);
console.log(Anon, Named);
console.log([Anon, Named], { a: Anon, n: Named });
new Named(1); new Named(2);
Named.hits = Named.hits + 10;
console.log(Named, Named.hits, Object.keys(Named), Object.entries(Anon));
console.log(new Anon().k, new Named(3).k, new Named(3) instanceof Base, new Anon() instanceof Named);
console.log("hits" in Named, "nope" in Named, Object.hasOwn(Named, "note"));
const two = mkNamed(9);
bag.two = two;
console.log(anyv(two) === Named, anyv(two) === bag.two, anyv(two).note, Named.note);
try { anyv(Named)(); } catch (e) { console.log(e.name + ": " + e.message); }
try { Named.hits = 1; Named.fresh = 5; console.log("fresh assigned", Named.hits); } catch (e) { console.log("threw", e.constructor.name); }
Named.extraA = [1, 2];
Named.extraB = "x";
console.log(Named, Object.keys(Named));
