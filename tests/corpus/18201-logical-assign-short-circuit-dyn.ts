// Logical assignment on any-typed locals, properties and elements: the right side is evaluated only
// when the store happens, and the stored value is visible after the statement.
function show(v: any): string { if (v === undefined) return "undef"; if (v === null) return "null"; if (typeof v === "object") return "obj:" + String(v.k); return typeof v + ":" + String(v); }
let calls = 0;
function f(): number { calls++; return 5; }
let x1: any = 1; x1 ??= f(); const q1 = x1; console.log("F1", show(q1), show(x1), calls);
let x2: any = 0; x2 ||= f(); const q2 = x2; console.log("F2", show(q2), show(x2), calls);
let x3: any = 0; x3 &&= f(); const q3 = x3; console.log("F3", show(q3), show(x3), calls);
let x4: any = 2; x4 &&= f(); const q4 = x4; console.log("F4", show(q4), show(x4), calls);
let x5: any = "s"; x5 ||= f(); const q5 = x5; console.log("F5", show(q5), show(x5), calls);
let x6: any = null; x6 ||= f(); const q6 = x6; console.log("F6", show(q6), show(x6), calls);
let x7: number | null = 4; x7 ??= f(); const q7 = x7; console.log("F7", show(q7), show(x7), calls);
const o8: any = { p: 1 }; o8.p ??= f(); const q8 = o8.p; console.log("F8", show(q8), show(o8.p), calls);
const o9: any = { p: null }; o9.p ??= f(); const q9 = o9.p; console.log("F9", show(q9), show(o9.p), calls);
const a10: any[] = [null]; a10[0] ??= f(); const q10 = a10[0]; a10[0] ??= f(); const q10b = a10[0]; console.log("F10", show(q10), show(q10b), calls);
const a11: any[] = [0]; a11[0] ||= f(); const q11 = a11[0]; console.log("F11", show(q11), show(a11[0]), calls);
let u12: any = null; u12 ??= (calls++, 7); const q12 = u12; console.log("F12", show(q12), show(u12), calls);
let u13: any = null; u13 ??= f(); u13 ??= f(); console.log("F13", show(u13), calls);
let u14: any = 0; u14 &&= f(); console.log("F14", show(u14), calls);
let u15: any = 3; u15 ||= f(); console.log("F15", show(u15), calls);
let w16: number = 0; w16 ||= f(); console.log("F16", show(w16), calls);
let w17: number = 0; w17 ??= f(); console.log("F17", show(w17), calls);
const o18: any = { p: null }; o18.p ??= f(); o18.p ??= f(); console.log("F18", show(o18.p), calls);
