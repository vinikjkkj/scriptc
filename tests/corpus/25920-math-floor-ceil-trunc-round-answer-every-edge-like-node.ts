// Math.floor / ceil / trunc / round over -0, NaN, the infinities, the halves around zero, 0.49999999999999994, the 2^51 / 2^52 / 2^53 / 2^63 boundaries and both signs, compared bit for bit (Object.is, so -0 is not 0).
const xs: number[] = [
  0, -0, NaN, Infinity, -Infinity, 0.5, -0.5, 0.49999999999999994, -0.49999999999999994, 0.5000000000000001, 1, -1, 1.5, -1.5, 2.5, -2.5, 0.1, -0.1, 0.9999999999999999,
  1.0000000000000002, 5e-324, -5e-324, 2.2250738585072014e-308, 1e-10, -1e-10, 123456.789, -123456.789, 65535.99999999999, 65536, -65536, 4294967296.5, -4294967296.5,
  2251799813685247.5, 2251799813685248, 2251799813685248.5, 2251799813685249, -2251799813685247.5, -2251799813685248, -2251799813685249,
  4503599627370495.5, 4503599627370496, 4503599627370497, -4503599627370495.5, -4503599627370496, -4503599627370497,
  9007199254740991, 9007199254740992, -9007199254740991, -9007199254740992, 9223372036854775807, 9223372036854775808, -9223372036854775808, 1e19, -1e19, 1e300, -1e300,
  1.7976931348623157e308, -1.7976931348623157e308, 3.5, -3.5, 4.5, -4.5, 1e15 + 0.5, -(1e15 + 0.5),
];
const show = (v: number): string => (Object.is(v, -0) ? "-0" : String(v));
const out: string[] = [];
for (const x of xs) {
  out.push(show(x) + " floor " + show(Math.floor(x)) + " ceil " + show(Math.ceil(x)) + " trunc " + show(Math.trunc(x)) + " round " + show(Math.round(x)));
}
// the same through a carry chain like feMul's: c = floor(t / 65536); t -= c * 65536; next += c
let t0 = 123456789.25, t1 = -987654321.75, t2 = 0.5;
let acc = 0;
for (let i = 0; i < 1000; i++) {
  let c = Math.floor(t0 / 65536);
  t0 -= c * 65536;
  t1 += c;
  c = Math.floor(t1 / 65536);
  t1 -= c * 65536;
  t2 += c;
  acc += t0 + t1 + Math.ceil(t2 / 7) + Math.trunc(t2 / -3);
  t0 = t0 * 3 + i - 50000.5;
  t2 = t2 - 1e6;
}
out.push("chain " + acc + " " + t0 + " " + t1 + " " + t2);
console.log(out.join("\n"));
