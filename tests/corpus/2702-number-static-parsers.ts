// `Number.parseInt` / `Number.parseFloat` are the GLOBAL parsers -- the
// spec aliases them -- and the globals already had a static lowering over
// exactly-typed arguments. Only the namespaced spelling was routed to the
// engine, so `Number.parseInt(s, 10)` needed the dynamic tier while a bare
// `parseInt(s, 10)` beside it compiled.
//
// Probed rather than forced: the ToNumber/ToString coercions over
// arbitrary values stay engine territory for both spellings alike, so a
// non-string argument still falls through to the same place it did before.
const decimals = ["42", "  7  ", "0", "-13", "999999", "12abc", "abc", ""];
for (const s of decimals) {
  console.log(s.trim() || "(vazio)", parseInt(s, 10), Number.parseInt(s, 10));
}

// Radices, both spellings agreeing.
console.log(parseInt("ff", 16), Number.parseInt("ff", 16));
console.log(parseInt("1010", 2), Number.parseInt("1010", 2));
console.log(parseInt("777", 8), Number.parseInt("777", 8));
console.log(parseInt("z", 36), Number.parseInt("z", 36));

// NaN cases have to agree too, including how they print.
console.log(Number.isNaN(Number.parseInt("abc", 10)), Number.isNaN(parseInt("abc", 10)));
console.log(`${Number.parseInt("nope", 10)}`);

// parseFloat, the sibling.
const floats = ["3.14", "  2.5e3 ", ".5", "-0.25", "7.", "1e-3", "nope"];
for (const s of floats) {
  console.log(parseFloat(s), Number.parseFloat(s));
}

// A computed string, so the argument is not a literal the checker folds.
function build(n: number): string {
  return `${n}${n}`;
}
console.log(Number.parseInt(build(3), 10), Number.parseFloat(build(4)));
