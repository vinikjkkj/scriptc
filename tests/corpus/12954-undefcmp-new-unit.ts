// A constructor call inside a unit comparison.
class C { constructor() { console.log("ctor"); } }
function mk(): C { console.log("mk"); return new C(); }
console.log(new C() !== undefined);
console.log(mk() === null);
