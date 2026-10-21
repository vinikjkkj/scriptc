// The bundled zone database: local fields and offsets over the whole of time, zone-independent source,
// compared byte-for-byte with node under every zone the harness sets (TZ). One line per instant.
let seed = 20261021;
function next(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function line(t: number): string {
  const d = new Date(t);
  return (
    t + " " + d.getTimezoneOffset() + " " + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() +
    " " + d.getHours() + ":" + d.getMinutes() + ":" + d.getSeconds() + "." + d.getMilliseconds() + " " + d.getDay()
  );
}
const fixed: number[] = [
  0, -1, 1, 86399999, -86400001, 1e12, 2e12, 4e12, 8.64e15 - 86400000 * 2, -8.64e15 + 86400000 * 2,
  -62198755200000, -2208988800000, -2177452800000, -1000000000000, 253402300799000, 4102444800000,
  4133980800000, 7258118400000, 32503680000000, 1792587600000, 1773446400000, 1805000000000,
];
for (const t of fixed) console.log(line(t));
// uniform over 1800..2200, then 1500..3500, then the whole range
for (let i = 0; i < 600; i++) console.log(line(Math.floor(-5364662400000 + next() * (7258118400000 + 5364662400000))));
for (let i = 0; i < 200; i++) console.log(line(Math.floor(-14831769600000 + next() * (60589574400000 + 14831769600000))));
for (let i = 0; i < 100; i++) console.log(line(Math.floor((next() * 2 - 1) * 8.63e15)));
// a daily sweep around the two recurring transitions of 2026 and 2037, hourly
for (let h = -30; h <= 30; h++) console.log(line(1773446400000 + h * 3600000));
for (let h = -30; h <= 30; h++) console.log(line(1792746000000 + h * 3600000));
for (let h = -30; h <= 30; h++) console.log(line(2120000000000 + h * 3600000 * 17));
