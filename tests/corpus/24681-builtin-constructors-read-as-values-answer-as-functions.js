// A bare builtin constructor read as a VALUE (a record field, a variable, an array slot) is a function in Node: typeof, identity,
// name, length and String() all agree, for the primitive constructors the runtime boxes and for the ones it only names.
const m = { s: String, n: Number, b: Boolean, f: Function, a: Array, o: Object, mp: Map, st: Set, d: Date, wm: WeakMap, re: RegExp };
console.log(typeof m.s, typeof m.n, typeof m.b, typeof m.f, typeof m.a, typeof m.o, typeof m.mp, typeof m.st, typeof m.d, typeof m.wm, typeof m.re);
console.log(m.s === String, m.n === Number, m.b === Boolean, m.f === Function, m.a === Array, m.o === Object);
console.log(m.mp === Map, m.st === Set, m.d === Date, m.wm === WeakMap, m.re === RegExp, m.s === m.n, m.mp === m.st);
console.log(m.s.name, m.n.name, m.b.name, m.f.name, m.a.name, m.o.name, m.mp.name, m.st.name, m.d.name, m.wm.name, m.re.name);
console.log(m.s.length, m.n.length, m.b.length, m.f.length, m.a.length, m.o.length, m.mp.length, m.st.length, m.d.length, m.wm.length, m.re.length);
console.log(String(m.s), String(m.mp), `${m.st}`, m.d + "");
