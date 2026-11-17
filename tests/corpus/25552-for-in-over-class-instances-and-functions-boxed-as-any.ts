// Class instances list their fields in creation order (declared, then the ones a method wrote), never methods or accessors; a function lists its own properties.
function keys(x: any): string { const out: string[] = []; for (const k in x) out.push(k); return out.join(","); }
class P { a = 1; b = 2; m() {} get g() { return 1; } static s = 3; }
class Q extends P { c = 3; }
const q = new Q();
console.log(keys(new P()), "|", keys(q), "|", keys(P));
const fn: any = function () {}; fn.p = 1; fn.q = 2;
console.log(keys(fn), "|", keys(() => 1));
let n = 0;
for (const k in q as any) { if (k === "b") continue; n++; if (n > 2) break; }
console.log(n);
