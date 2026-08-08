// The same four statics as VALUES from TypeScript. The lift is deliberately
// NOT JavaScript-gated the way the Object.keys and String.prototype ones are,
// and this fixture is why: those two hand back a representation the checker
// did not promise (a checked-dynamic list; a body that reads an ambient
// receiver TypeScript cannot bind). These four are declared
// `(number: unknown) => boolean`, which maps to exactly `(dyn) => bool` —
// the lifted closure's type IS the annotation at the use site, so there is
// nothing for a TypeScript consumer to be surprised by, and no reason for
// the fence to survive here.
const isInt: (v: unknown) => boolean = Number.isInteger;
const isFin: (v: unknown) => boolean = Number.isFinite;
const isNan: (v: unknown) => boolean = Number.isNaN;
const isSafe: (v: unknown) => boolean = Number.isSafeInteger;

console.log(isInt(0), isInt(-0), isInt(1.5), isInt(NaN), isInt(Infinity));
console.log(isInt("3"), isInt(null), isInt(undefined), isInt(true));
console.log(isFin(1), isFin(Infinity), isFin("1"));
console.log(isNan(NaN), isNan("NaN"), isNan(1));
console.log(isSafe(9007199254740991), isSafe(9007199254740992), isSafe("1"));

// The `||` escape, annotated: the static is truthy, so the fallback is dead
// and never evaluates.
const fallback = (v: unknown): boolean =>
  typeof v === "number" && isFinite(v) && Math.floor(v) === v;
const chosen: (v: unknown) => boolean = Number.isInteger || fallback;
console.log(chosen(4), chosen(4.25), chosen("4"));
