// The constructor VALUES reachable through Object.getPrototypeOf: a class's prototype names the class (typeof, `.name` and identity match
// `inst.constructor`, and a derived class's prototype names the derived class), the Array prototype's constructor builds arrays with
// Array's own argument rules (no argument, a length, a single element, several elements, the RangeError for an invalid length), and the
// Function prototype's constructor is the sanctioned text path (the embedded engine builds the function exactly as `new Function` does).
class A { constructor() { this.v = 1; } m() { return 2; } }
class B extends A { }
function proto(x) { return Object.getPrototypeOf(x); }
const a = new A(), b = new B();
const pa = proto(a);
console.log(typeof pa.constructor, pa.constructor.name, pa.constructor === a.constructor, pa.constructor === A, proto(b).constructor === b.constructor, proto(b).constructor.name);
const ap = proto([]);
const mkArr = ap.constructor;
console.log(JSON.stringify(mkArr()), JSON.stringify(mkArr(3)), mkArr(3).length, JSON.stringify(mkArr(1, 2)), JSON.stringify(mkArr("x")), JSON.stringify(mkArr(0)));
try { mkArr(-1); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
try { mkArr(1.5); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
const F = proto(function () {}).constructor;
const add = F("a", "b", "return a + b");
console.log(typeof F, F.name, typeof add, add(2, 3), F("return 7")());
