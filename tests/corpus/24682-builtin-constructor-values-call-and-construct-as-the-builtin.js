// A String/Number/Boolean/Array/Object constructor held in a field CALLS and CONSTRUCTS as the builtin does.
const m = { s: String, n: Number, b: Boolean, a: Array, o: Object };
console.log(m.s(5), m.s(null), m.s(undefined), m.s(true), m.s());
console.log(m.n("7"), m.n(""), m.n("x"), m.n(null), m.n(undefined), m.n(true), m.n());
console.log(m.b(""), m.b("a"), m.b(0), m.b(1), m.b(null), m.b());
console.log(m.a(3).length, m.a(1, 2, 3).length, m.a("x")[0], m.a().length);
console.log(typeof m.o(1), typeof m.o("s"), Object.keys(m.o()).length);
console.log(Number(new m.n(3)) + 1, typeof new m.s("x"), String(new m.s("hi")), `${new m.n(8)}`);
console.log(typeof new m.b(0), Boolean(new m.b(0)), new m.a(2).length);
