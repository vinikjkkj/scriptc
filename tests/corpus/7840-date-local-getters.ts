// Local-time Date getters, getTimezoneOffset and getDay/getUTCDay over a
// Date value, across DST transitions, the epoch, pre-1900 (LMT) instants and
// both clip edges. The output depends on TZ; the runner compares against
// Node under the same TZ.
const stamps: number[] = [
  0,
  -1,
  1,
  86399999,
  951782400000,
  1004745600000,
  1100000000000,
  1330000000123,
  1350000000000,
  1561939199999,
  1572000000000,
  1583000000000,
  1700000000000,
  1710054000000,
  1730000000000,
  1741500000000,
  4102444800000,
  -86400000 * 365 * 70,
  -2000000000000,
  -3000000000000,
  -62135596800000,
  -8640000000000000,
  8640000000000000,
  NaN,
];
function line(d: Date): string {
  return [
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
    d.getDay(),
    d.getUTCDay(),
    d.getTimezoneOffset(),
  ].join(",");
}
for (const ms of stamps) {
  console.log(String(ms) + " " + line(new Date(ms)));
}
let t = 1262304000000;
let n = 0;
while (t < 1700000000000) {
  console.log(line(new Date(t)));
  t += 86400000 * 9 + 3600000 * 7 + 123456;
  n++;
}
console.log(n);
