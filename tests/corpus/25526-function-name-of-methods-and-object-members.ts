// Methods and members are named by their key, however the value is reached.
class K { m() {} static s() {} static arrow = () => 1; field = () => 2; }
const o = { m() { return 1; }, f: () => 2, g: function () { return 3; } };
console.log(K.prototype.m.name, K.s.name, K.arrow.name, new K().field.name);
console.log(o.m.name, o.f.name, o.g.name);
function foo() {}
const fns = { foo, bar: foo };
console.log(fns.foo.name, fns.bar.name);
const table: Record<string, () => void> = { one() {}, two: () => {}, three: function () {} };
console.log(Object.keys(table).map((k) => table[k]!.name).join("|"));
