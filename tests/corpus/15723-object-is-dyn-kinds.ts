// Object.is over dyn (any) operands discriminates by type and identity across
// every kind the checked-dynamic box holds: strings by bytes, booleans,
// undefined and null by their own kinds, numbers never equal to strings,
// objects and functions by identity, class instances by identity, bigints by
// value, and a dyn operand against a static program object (both sides).
class P {
  n = 1;
}
const s1: any = "1";
const s2: any = JSON.parse('"1"');
const n1: any = 1;
const t: any = true;
const f: any = false;
const u: any = undefined;
const nl: any = null;
const o1: any = { a: 1 };
const o2: any = { a: 1 };
const fn1: any = () => 1;
const bi: any = 10n;
const pi: any = new P();
const arr: any = [1];
console.log("strings", Object.is(s1, s2), Object.is(s1, "1"), Object.is(s1, ""), Object.is("1", s2));
console.log("string-number", Object.is(s1, n1), Object.is(n1, s1), Object.is(JSON.parse("1"), s1));
console.log("bool", Object.is(t, true), Object.is(f, false), Object.is(t, 1), Object.is(f, 0), Object.is(t, "true"));
console.log("units", Object.is(u, undefined), Object.is(nl, null), Object.is(u, nl), Object.is(nl, undefined));
console.log("units vs scalars", Object.is(u, 0), Object.is(nl, 0), Object.is(u, ""), Object.is(nl, false));
console.log("objects", Object.is(o1, o1), Object.is(o1, o2), Object.is(o1, o1.a), Object.is(arr, arr));
console.log("functions", Object.is(fn1, fn1), Object.is(fn1, () => 1), Object.is(fn1, o1));
console.log("bigint", Object.is(bi, 10n), Object.is(bi, 11n), Object.is(bi, 10), Object.is(10n, bi));
const p = new P();
const pa: any = p;
console.log("instances", Object.is(pi, pi), Object.is(pi, new P()), Object.is(pa, p), Object.is(p, pa));
console.log("mixed", Object.is(n1, undefined), Object.is(s1, undefined), Object.is(nl, o1));
