// The ASN1_TIME_print shape a certificate's validity prints in, parsed as legacy text.
const xs: string[] = [
  "Jul  1 00:00:00 2026 GMT",
  "Dec 31 23:59:59 1999 GMT",
  "Feb 29 12:00:00 2024 GMT",
  "Jul 17 17:52:11 2126 GMT",
];
const expiry = Date.parse(xs[3]!);
const from = Date.parse(xs[0]!);
console.log(from, expiry, expiry - from);
for (const s of xs) console.log(s, Date.parse(s));
