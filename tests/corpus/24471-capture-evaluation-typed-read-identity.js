function make(prefix, n) { class C { constructor(){ this.v = n } viaCapture(){ return prefix + n } viaBoth(){ return prefix + this.v } } return new C() }
const a = make("p", 1), b = make("q", 2), a2 = a;
const f = a.viaCapture;
console.log(f());
console.log(f.call(b));
console.log(f.apply(b, []));
console.log(f.bind(b)());
console.log(a.viaCapture === a2.viaCapture, a.viaCapture === b.viaCapture, a.viaCapture === a.viaCapture);
const g = a.viaBoth;
try { console.log(g.call(b)); } catch (e) { console.log("T", e.name); }
try { console.log(g()); } catch (e) { console.log("T", e.name); }
console.log(a.viaBoth(), b.viaBoth(), a.viaCapture(), b.viaCapture());
console.log(f.name, typeof f);
