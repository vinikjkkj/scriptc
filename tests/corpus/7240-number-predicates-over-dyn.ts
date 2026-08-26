// The four Number predicate statics over a CHECKED-DYNAMIC argument.
//
// They never coerce, so `false` for every non-number kind is the specified
// answer rather than a fallback, and the number kind runs the same static
// an f64-typed call site gets. A dyn argument is already the lowered
// value, so testing its kind skips no side effect — which is what made
// this the one non-f64 kind that can be answered instead of fenced. It
// used to refuse: `Number.isInteger of 'unknown' values`.
//
// This is `Number.isInteger(max)` over a destructured untyped option
// (mysql2 -> lru.min's createLRU) and the shape every untyped JS argument
// validator has.
const vals: unknown[] = [
  0,
  -0,
  1,
  -7,
  1.5,
  -1.5,
  NaN,
  Infinity,
  -Infinity,
  9007199254740991,
  9007199254740992,
  9007199254740993,
  -9007199254740991,
  1e21,
  "3",
  "",
  true,
  false,
  null,
  undefined,
];

for (const v of vals) {
  const row = [
    Number.isInteger(v) ? "I" : "-",
    Number.isFinite(v) ? "F" : "-",
    Number.isNaN(v) ? "N" : "-",
    Number.isSafeInteger(v) ? "S" : "-",
  ].join("");
  console.log(row);
}

// The same statics read as VALUES and called through the binding: the
// lifted body and the call form's dyn arm are one function, so these have
// to agree with the rows above.
const isInt = Number.isInteger;
const isFin = Number.isFinite;
let agree = 0;
for (const v of vals) {
  if (isInt(v) === Number.isInteger(v)) agree++;
  if (isFin(v) === Number.isFinite(v)) agree++;
}
console.log("agree=" + agree);

// Side effects on the argument still happen exactly once: the fence this
// replaced existed because folding to a constant would step past them.
let calls = 0;
const bump = (x: unknown): unknown => {
  calls++;
  return x;
};
console.log(Number.isInteger(bump("nope")));
console.log(Number.isSafeInteger(bump(4)));
console.log("calls=" + calls);
