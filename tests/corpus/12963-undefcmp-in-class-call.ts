// The class `in` fold over a call receiver: the call runs, the answer is the class's.
class C { x = 1; }
let n = 0;
function mk(): C { n++; console.log("mk " + n); return new C(); }
console.log("x" in mk());
console.log("y" in mk());
console.log("n=" + n);
