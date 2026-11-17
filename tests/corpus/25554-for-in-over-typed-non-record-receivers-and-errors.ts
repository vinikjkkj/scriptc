// Receivers with no record shape reach the dyn walk too: collections and dates list nothing, a typed array its indices, an Error its own custom properties.
class E2 extends Error { code = 1; detail = "d"; }
class E3 extends E2 { more = 2; }
const list = (label: string, ks: string[]) => console.log(label, ks.join(","));
const out = (x: any): string[] => { const o: string[] = []; for (const k in x) o.push(k); return o; };
const m = new Map([[1, 2]]); const mk: string[] = []; for (const k in m) mk.push(k); list("map", mk);
const sk: string[] = []; for (const k in new Set([1])) sk.push(k); list("set", sk);
const dk: string[] = []; for (const k in new Date(0)) dk.push(k); list("date", dk);
const tk: string[] = []; for (const k in new Uint8Array(3)) tk.push(k); list("u8", tk);
const rk: string[] = []; for (const k in /a/g) rk.push(k); list("re", rk);
const fk: string[] = []; for (const k in function f() {}) fk.push(k); list("fn", fk);
const e3 = new E3("m3"); (e3 as any).late = 5;
const ek: string[] = []; for (const k in e3) ek.push(k); list("e3", ek);
const e0 = new Error("e", { cause: "c" }); const e0k: string[] = []; for (const k in e0) e0k.push(k); list("e0", e0k);
list("any", out(e3)); list("any0", out(e0));
