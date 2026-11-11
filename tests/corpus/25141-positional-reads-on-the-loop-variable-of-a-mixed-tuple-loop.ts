// The loop variable of `for (const t of [["a", 1], ["b", "x"]] as const)` is a union of tuples for the checker. Destructuring it compiled
// (row 25129); reading `t[0]` / `t[1]`, `t.length`, or indexing with a variable were refused (SC1090 "element access on non-array values",
// "reading 'length' from a value of type ...").
for (const t of [["a", 1], ["b", "x"]] as const) {
  console.log(t[0], t[1], t.length, typeof t[1]);
}
for (const t of [[1, "one", true], ["two", 2, false]] as const) {
  console.log(t[0], t[1], t[2], t.length);
  let joined = "";
  for (let i = 0; i < t.length; i++) joined += String(t[i]) + ";";
  console.log(joined);
}
const f = (n: number): number => n + 1;
const g = (n: number): string => "g" + n;
for (const t of [["inc", f], ["tag", g]] as const) {
  console.log(t[0], t[1](41), typeof t[1](1));
}
const rows = [["id", 7, true], ["name", "seven", false]] as const;
const seen: string[] = [];
for (const row of rows) {
  if (row[2]) seen.push(String(row[0]) + "=" + String(row[1]));
  else seen.push("-" + String(row[0]));
}
console.log(seen.join(","));
