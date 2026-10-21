// Object.prototype.toString.call over statically typed operands, unions and
// `unknown`, plus the isDate / isTemporal predicate idiom built on it.
const tag = (value: unknown): string => Object.prototype.toString.call(value);
const isDate = (value: unknown): value is Date => Object.prototype.toString.call(value) === "[object Date]";
const isTemporal = (value: unknown): boolean => Object.prototype.toString.call(value).startsWith("[object Temporal.");

console.log(tag(null), tag(undefined), tag(1), tag("s"), tag(true), tag(10n));
console.log(tag([]), tag([1, 2]), tag({}), tag({ a: 1 }), tag(() => 1));
console.log(tag(new Date(5)), tag(new Date(NaN)), tag(/x/g), tag(new Map<string, number>()), tag(new Set<number>()));
console.log(tag(new Uint8Array([1, 2])), tag(Buffer.from("ab")));
console.log(isDate(new Date(0)), isDate({}), isDate(null), isDate("x"), isDate(3), isDate([new Date(0)]));
console.log(isTemporal({}), isTemporal(new Date(0)));

type U = string | number | Date | number[] | null;
const us: U[] = ["a", 1, new Date(1), [1], null];
for (const u of us) console.log(Object.prototype.toString.call(u));

const n = 5;
const s = "x";
const d = new Date(7);
const arr = [1, 2];
console.log(Object.prototype.toString.call(n), Object.prototype.toString.call(s), Object.prototype.toString.call(d), Object.prototype.toString.call(arr));
let calls = 0;
const mk = (): Date => {
  calls++;
  return new Date(1);
};
console.log(Object.prototype.toString.call(mk()), calls);
