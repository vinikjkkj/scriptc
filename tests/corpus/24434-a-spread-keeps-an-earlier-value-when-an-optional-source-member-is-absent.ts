// JavaScript lets a spread override an earlier property only when the source HAS the key (an own undefined counts). An optional
// source member that is absent leaves the earlier value standing, in the key order the earlier contributor gave it.
interface P { a?: number; b?: number; c?: number }
const f1: P = {}; f1.b = 1; f1.a = 2;
const c4: P = { c: 5, ...f1 };
console.log(Object.keys(c4).join(","), JSON.stringify(c4), c4);
const f2: P = {}; f2.c = 9; f2.a = 1;
const c5: P = { c: 5, ...f2 };
console.log(Object.keys(c5).join(","), JSON.stringify(c5), c5);
const f3: P = { c: undefined };
const c6: P = { c: 5, ...f3 };
console.log(Object.keys(c6).join(","), JSON.stringify(c6), c6.c);
const g1: P = {}; g1.a = 1;
const g2: P = {}; g2.b = 2;
const m1: P = { ...g1, ...g2 };
console.log(Object.keys(m1).join(","), JSON.stringify(m1));
const g3: P = {}; g3.a = 7;
const m2: P = { ...g1, ...g3 };
console.log(Object.keys(m2).join(","), JSON.stringify(m2));

// defaults first, overrides after: a required default stays when the override does not carry the key
interface Cfg { host: string; port?: number; tls?: boolean }
interface Over { port?: number; tls?: boolean }
const defaults: Cfg = { host: "h", port: 80, tls: false };
const ov: Over = {}; ov.tls = true;
const merged: Cfg = { ...defaults, ...ov };
console.log(Object.keys(merged).join(","), JSON.stringify(merged), merged);
const ov2: Over = {};
const merged2: Cfg = { ...defaults, ...ov2 };
console.log(JSON.stringify(merged2));
