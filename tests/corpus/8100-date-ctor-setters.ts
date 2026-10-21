// Date component constructor and every setter, Node-exact including DST
// gaps/overlaps, NaN propagation, the 2-digit-year rule and clip edges. The
// output depends on TZ; the runner compares against Node under the same TZ.
function f(d: Date): string {
  const t = d.getTime();
  return Number.isNaN(t) ? "NaN" : String(t);
}
let seed = 12345;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(): number {
  const r = rnd();
  const specials = [NaN, Infinity, -Infinity, 0, -0, 1, -1, 1.5, -1.5, 99, 100, 0.9, 1e6, -1e6, 1e7, 1e9, 275760, 271821, 12, 13, -13, 24, 60, 1000, 86400000, 8.64e15, 1e20];
  if (r < 0.3) return specials[Math.floor(rnd() * specials.length)]!;
  if (r < 0.6) return Math.floor(rnd() * 200) - 50;
  if (r < 0.8) return Math.floor(rnd() * 4000);
  return (rnd() - 0.5) * 100000;
}
const gaps: number[][] = [
  [2024, 2, 10, 2, 30], [2024, 10, 3, 1, 30], [2018, 10, 4, 0, 30], [2019, 1, 16, 23, 30],
  [2024, 2, 31, 1, 30], [2024, 9, 27, 1, 30], [2024, 9, 6, 2, 15], [2024, 3, 7, 1, 45],
  [2024, 8, 29, 2, 45], [2011, 11, 30, 12, 0], [2011, 11, 29, 12, 0], [1970, 0, 1, 0, 0],
  [1969, 11, 31, 23, 59], [1900, 0, 1, 0, 0], [1883, 10, 18, 12, 0], [2038, 0, 19, 3, 14],
  [2100, 2, 28, 2, 30], [1918, 2, 31, 2, 30], [1945, 8, 30, 1, 30], [2026, 9, 25, 2, 30],
];
for (const g of gaps) {
  const d = new Date(g[0]!, g[1]!, g[2]!, g[3]!, g[4]!);
  console.log("gap", g.join(","), f(d), d.getHours(), d.getMinutes(), d.getDate());
  // walk across the transition by 15-minute steps with setMinutes
  const w = new Date(g[0]!, g[1]!, g[2]!, 0, 0);
  const row: string[] = [];
  for (let i = 0; i < 12; i++) {
    row.push(w.getHours() + ":" + w.getMinutes());
    w.setMinutes(w.getMinutes() + 30);
  }
  console.log(" walk", row.join(" "));
}
for (let i = 0; i < 400; i++) {
  const n = 2 + Math.floor(rnd() * 6);
  const a: number[] = [];
  for (let k = 0; k < 7; k++) a.push(pick());
  let d: Date;
  switch (n) {
    case 2: d = new Date(a[0]!, a[1]!); break;
    case 3: d = new Date(a[0]!, a[1]!, a[2]!); break;
    case 4: d = new Date(a[0]!, a[1]!, a[2]!, a[3]!); break;
    case 5: d = new Date(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!); break;
    case 6: d = new Date(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!); break;
    default: d = new Date(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!); break;
  }
  console.log("ctor", n, a.join(","), f(d));
}
const bases = [0, 1700000000123, -1, 951782400000, 1710054000000, 1730592000000, NaN, 8.64e15, -8.64e15, -3e12, 4.1e12];
for (const b of bases) {
  for (let i = 0; i < 40; i++) {
    const d = new Date(b);
    const a = [pick(), pick(), pick(), pick()];
    const op = Math.floor(rnd() * 15);
    let r = 0;
    const argc = 1 + Math.floor(rnd() * 4);
    switch (op) {
      case 0: r = d.setMilliseconds(a[0]!); break;
      case 1: r = argc > 1 ? d.setSeconds(a[0]!, a[1]!) : d.setSeconds(a[0]!); break;
      case 2: r = argc > 2 ? d.setMinutes(a[0]!, a[1]!, a[2]!) : argc > 1 ? d.setMinutes(a[0]!, a[1]!) : d.setMinutes(a[0]!); break;
      case 3: r = argc > 3 ? d.setHours(a[0]!, a[1]!, a[2]!, a[3]!) : argc > 2 ? d.setHours(a[0]!, a[1]!, a[2]!) : argc > 1 ? d.setHours(a[0]!, a[1]!) : d.setHours(a[0]!); break;
      case 4: r = d.setDate(a[0]!); break;
      case 5: r = argc > 1 ? d.setMonth(a[0]!, a[1]!) : d.setMonth(a[0]!); break;
      case 6: r = argc > 2 ? d.setFullYear(a[0]!, a[1]!, a[2]!) : argc > 1 ? d.setFullYear(a[0]!, a[1]!) : d.setFullYear(a[0]!); break;
      case 7: r = d.setUTCMilliseconds(a[0]!); break;
      case 8: r = argc > 1 ? d.setUTCSeconds(a[0]!, a[1]!) : d.setUTCSeconds(a[0]!); break;
      case 9: r = argc > 2 ? d.setUTCMinutes(a[0]!, a[1]!, a[2]!) : argc > 1 ? d.setUTCMinutes(a[0]!, a[1]!) : d.setUTCMinutes(a[0]!); break;
      case 10: r = argc > 3 ? d.setUTCHours(a[0]!, a[1]!, a[2]!, a[3]!) : argc > 2 ? d.setUTCHours(a[0]!, a[1]!, a[2]!) : argc > 1 ? d.setUTCHours(a[0]!, a[1]!) : d.setUTCHours(a[0]!); break;
      case 11: r = d.setUTCDate(a[0]!); break;
      case 12: r = argc > 1 ? d.setUTCMonth(a[0]!, a[1]!) : d.setUTCMonth(a[0]!); break;
      case 13: r = argc > 2 ? d.setUTCFullYear(a[0]!, a[1]!, a[2]!) : argc > 1 ? d.setUTCFullYear(a[0]!, a[1]!) : d.setUTCFullYear(a[0]!); break;
      default: r = d.setTime(a[0]!); break;
    }
    console.log("set", b, op, argc, a.join(","), Number.isNaN(r) ? "NaN" : r, f(d), Object.is(r, d.getTime()));
  }
}
// aliasing: a setter is visible through every reference
const rec = { at: new Date(0) };
const alias = rec.at;
alias.setTime(86400000);
alias.setUTCHours(5);
console.log("alias", rec.at.getTime(), rec.at === alias);
const copy = new Date(alias);
copy.setUTCFullYear(2000);
console.log("copy", alias.getTime(), copy.getTime());
// a failed setter leaves an invalid date invalid; setFullYear revives it
const inv = new Date(NaN);
console.log("inv", inv.setHours(3), inv.setMonth(1), inv.setDate(4), f(inv));
console.log("revive", inv.setFullYear(2020), f(inv), inv.getMonth(), inv.getDate(), inv.getHours());
const inv2 = new Date(NaN);
console.log("revive utc", inv2.setUTCFullYear(1999, 5, 6), f(inv2));
