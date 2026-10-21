// Date.prototype.toString/toDateString/toTimeString/toUTCString/toGMTString/
// toLocale{,Date,Time}String and getYear across zones (ICU long names, DST flag by
// instant, the equivalent-year rule outside 1970..2038). Compared with Node under TZ.
const stamps: number[] = [
  0, -1, 1700000000123, 951782400000, 1710054000000, 1730592000000, 1720000000000, 1688000000000,
  1330000000123, 1004745600000, 4102444800000, 2147483647000, 2147483648000, 2200000000000,
  -86400000 * 365 * 70, -2000000000000, -3000000000000, -62198755200000, -62135596800000,
  -62167219200000, -1e14, 3e14, 253402300800000, -8640000000000000, 8640000000000000, NaN,
  1224000000000, 1257000000000, 1288000000000, 5e12, 7e12, 9e12, -5e12, -1.2e13,
];
for (const s of stamps) {
  const d = new Date(s);
  console.log(
    d.toString(), "|", d.toDateString(), "|", d.toTimeString(), "|", d.toUTCString(), "|",
    d.toLocaleString(), "|", d.toLocaleDateString(), "|", d.toLocaleTimeString(),
    "|", String(d), `${d}`,
  );
}
// a walk of one day through every hour across a year of transitions
let t = Date.UTC(2024, 0, 1);
const names = new Set<string>();
for (let i = 0; i < 366 * 4; i++) {
  const d = new Date(t + i * 6 * 3600000);
  const s = d.toString();
  names.add(s.slice(s.indexOf("(")));
}
console.log(Array.from(names).sort().join(";"));
function viaAny(a: any): string {
  const parts: string[] = [];
  parts.push(String(a.toString()), String(a.toDateString()), String(a.toTimeString()), String(a.toUTCString()));
  parts.push(String(a.toGMTString()), String(a.getYear()));
  return parts.join(" | ");
}
for (const s of stamps) console.log(viaAny(new Date(s)));
