// Relational operators over dyn operands: number pairs (the fast path), NaN and signed zero, infinities,
// number against numeric string, string against string, null/undefined/boolean, objects with valueOf, and a
// bigint pair. Every pair answers all four operators; the helper has untyped parameters so each is a dyn compare.
function rel(a, b) {
  return (a < b ? "1" : "0") + (a <= b ? "1" : "0") + (a > b ? "1" : "0") + (a >= b ? "1" : "0");
}
const vals = [0, -0, 1, -1, 0.5, 2, 10, 1e21, -1e21, 5e-324, Infinity, -Infinity, NaN, 2147483648, 9007199254740993,
  "1", "", " 2 ", "abc", "10", "2", "0x10", "-0", "NaN", true, false, null, undefined, 3n, 2n,
  { valueOf() { return 1; } }, { valueOf() { return NaN; } }, [], [2], [1, 2], { toString() { return "7"; } }];
const names = ["0", "-0", "1", "-1", "0.5", "2", "10", "1e21", "-1e21", "5e-324", "inf", "-inf", "nan", "2^31", "2^53+1",
  "'1'", "''", "' 2 '", "'abc'", "'10'", "'2'", "'0x10'", "'-0'", "'NaN'", "true", "false", "null", "undef", "3n", "2n",
  "vo1", "voNaN", "[]", "[2]", "[1,2]", "ts7"];
const rows = [];
for (let i = 0; i < vals.length; i++) {
  let line = names[i] + ":";
  for (let j = 0; j < vals.length; j++) {
    let r;
    try { r = rel(vals[i], vals[j]); } catch (e) { r = e instanceof TypeError ? "ET" : "E?"; }
    line += " " + r;
  }
  rows.push(line);
}
console.log(rows.join("\n"));
// a hot loop of number compares plus a megamorphic mix, so the fast path and the fallback share call sites
let hits = 0;
const mix = [1, "2", 3, NaN, -0, 0, "x", null, 4.5];
for (let n = 0; n < 5000; n++) {
  const a = mix[n % mix.length], b = mix[(n * 7 + 3) % mix.length];
  if (a < b) hits += 1;
  if (a <= b) hits += 2;
  if (a > b) hits += 4;
  if (a >= b) hits += 8;
}
console.log("hits", hits);
