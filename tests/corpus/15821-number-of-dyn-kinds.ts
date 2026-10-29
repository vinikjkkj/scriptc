// Number(v) over a checked-dynamic value (TS any, unknown after a cast, JSON.parse results):
// ToNumber over every primitive kind (StringToNumber grammar, booleans, null, undefined), arrays
// through their toString join, plain objects and functions (NaN), and class instances through
// the valueOf or toString they declare. Node is the oracle; the printed values include -0.
class Ten { valueOf(): number { return 10; } }
class Sub extends Ten { }
class Words { toString(): string { return "0x20"; } }
class ObjValueOf { valueOf(): object { return {}; } toString(): string { return "5"; } }
class ObjOnly { valueOf(): object { return {}; } }
class Shape { x = 1; }
function g(v: any): number { return Number(v); }
const j = JSON.parse('{"a":1,"s":" 0x10 ","t":true,"n":null,"arr":[],"one":[5],"two":[1,2],"str":["3"],"nest":[[" 2 "]],"o":{},"e":""}');
console.log(g(j.a), g(j.s), g(j.t), g(j.n), g(j.arr), g(j.one), g(j.two), g(j.str), g(j.nest), g(j.o), g(j.e));
console.log(g(j.missing), g(undefined), g(null), g(true), g(false), g("0b101"), g("0o17"), g("1e3"), g("-0"));
console.log(g(" Infinity "), g("abc"), g(""), g("  \n\t 42 \r"), g("1_0"), g(".5"), g("5."), g("0x"));
console.log(g(new Date(5)), g(() => 1), g({ valueOf() { return 4; } }), g({ toString() { return "12"; } }));
console.log(g(new Ten()), g(new Sub()), g(new Words()), g(new ObjValueOf()), g(new ObjOnly()), g(new Shape()));
console.log(g(5n), g(12345678901234567890n));
const u: unknown = "  99 ";
console.log(Number(u), Number(j.a as unknown));
try { g(Symbol("q")); console.log("no throw"); } catch (e) { console.log((e as Error).name, (e as Error).message); }
