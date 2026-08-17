// Was tests/diagnostics/expressions.ts, which pinned
//
//   SC1090: object spread of computed sources (the field copies re-read the
//   source - bind it to a const first)
//
// at `{ ...{ a: 1 } }`. That fence is gone: the source is an object LITERAL,
// so there is nothing to re-read, and the entry stopped failing - which made
// it a diagnostics program that produced no diagnostics. The subject moves
// here, where Node is the oracle and nothing has to be pinned by hand.
//
// The spread's result is READ (`o.a`), not just bound: an unread binding is
// deadstrip fodder and would let the lowering disappear while the fixture
// still passed.
//
// `in` over an object literal rides along - the same "the operand is a
// literal, not a re-read" shape on the other operator - and so does
// `typeof` of a CALL result, which folds to "number" only after the call
// runs.
const n: number = 3;
const t = n > 0 ? "pos" : "neg";
const o = { ...{ a: 1 } };
const b = "a" in { a: 1 };
const m = typeof "ab".indexOf("b");
const u = n === 3 ? 1 : 2;
const s: string = "abc";
const mixed = n === 3 && s;
console.log(t, m, u, b, mixed);
console.log(o.a, o);

// A spread of a literal that OVERRIDES a later field, and one that is
// overridden: the copy order is the literal's own.
const over = { ...{ a: 1, b: 2 }, b: 3 };
console.log(over.a, over.b, over);

// Two spreads of literals in one target: the second wins on the shared key.
const both = { ...{ a: 1, b: 2 }, ...{ b: 9, c: 4 } };
console.log(both.a, both.b, both.c, both);
