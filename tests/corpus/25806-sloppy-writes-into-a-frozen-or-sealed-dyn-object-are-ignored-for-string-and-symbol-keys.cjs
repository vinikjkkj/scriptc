// Sloppy mode (a CommonJS file): refused writes, deletes and adds on a frozen / sealed / non-extensible dyn object, string- and symbol-keyed, are
// silently ignored; Object.assign still throws.
const sym = Symbol("tag");
const sym2 = Symbol("late");
const o = JSON.parse('{"a":1}');
o[sym] = 1;
Object.freeze(o);
o[sym] = 2; o[sym2] = 3; o.a = 9; o.z = 1; delete o[sym]; delete o.a;
console.log(o[sym], o[sym2], o.a, o.z, Object.keys(o));
const s = Object.create(Object.prototype);
s.a = 1; s[sym] = 1;
Object.seal(s);
s.a = 2; s[sym] = 2; s[sym2] = 2; s.b = 2; delete s.a; delete s[sym];
console.log(s.a, s[sym], s[sym2], s.b);
const p = Object.create(Object.prototype);
p.a = 1; p[sym] = 1;
Object.preventExtensions(p);
p[sym2] = 2; p.b = 2; p[sym] = 5; delete p.a;
console.log(p.a, p[sym], p[sym2], p.b);
const src = Object.create(Object.prototype); src[sym2] = 1;
try { Object.assign(o, src); } catch (e) { console.log((e).message); }
