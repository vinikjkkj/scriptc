// Object.defineProperty(F, k, { get, set }) over a function value and over a class value (ioredis index.js): the accessor lives in the function's own property table, the getter runs with
// `this` bound to the function / class, and `F.k = v` runs the setter.
function F() {}
let stored = 0;
Object.defineProperty(F, "hidden", { get() { return this === F ? "bound:" + stored : "unbound"; }, set(v) { stored = v; } });
Object.defineProperty(F, "shown", { enumerable: true, get() { return "s" + stored; } });
console.log(F.hidden, F.shown);
F.hidden = 5;
console.log(F.hidden, F.shown, stored);
function G() {}
Object.defineProperty(G, "Promise", { get() { console.log("warn"); return Promise; }, set(_l) { console.log("set ignored"); } });
G.Promise = 3;
console.log(typeof G.Promise, G.Promise === Promise);
class A { static s = 1; constructor() { this.x = 2; } }
let store = 0;
Object.defineProperty(A, "Q", { get() { return this === A ? 5 + store : -1; }, set(v) { store = v; } });
console.log(A.s, A.Q);
A.Q = 7;
console.log(A.Q, store, new A().x);
