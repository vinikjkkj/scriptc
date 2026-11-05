// Promotion to a view keeps the object's own key order, and a member that was never set stays absent (not undefined).
interface Base { b?: number; a?: string }
interface Wide { z?: boolean; a?: string; b?: number; c: number }
function keysOf(o: Base): string { return Object.keys(o).join(); }
function setB(o: Base): void { o.b = 2; }
function clearA(o: Base): void { o.a = undefined; }
const w: Wide = { c: 1, a: "x" };
console.log(keysOf(w), Object.keys(w).join(), "b" in w, w.b);
setB(w);
console.log(keysOf(w), Object.keys(w).join(), "b" in w, w.b);
clearA(w);
console.log(keysOf(w), Object.keys(w).join(), "a" in w, w.a);
console.log(JSON.stringify(w));
