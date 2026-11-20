// Array.isArray of a computed operand (a call, a method result): the answer is decided or tested on the value, and the operand runs once.
function mk() { console.log("mk"); return [1, 2]; }
function mkS() { console.log("mkS"); return "s"; }
console.log(Array.isArray(mk()), Array.isArray(mkS()), Array.isArray(mk().map((x) => x)));
const u: unknown[] = [mk(), 1];
console.log(Array.isArray(u[0]), Array.isArray(u.slice(0, 1)));
function pick(n: number): string | string[] | number { console.log("pick"); return n === 0 ? ["a"] : n === 1 ? "s" : 3; }
function pick2(n: number): string | number { console.log("pick2"); return n === 0 ? "a" : 3; }
console.log(Array.isArray(pick(0)), Array.isArray(pick(1)), Array.isArray(pick2(0)), Array.isArray(pick2(1)));
const o = { f: (): string[] | undefined => { console.log("f"); return undefined; } };
console.log(Array.isArray(o.f()));
