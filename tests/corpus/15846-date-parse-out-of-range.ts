// Date.parse of field values outside their ranges: NaN, Node's invalid date.
const xs: string[] = [
  "2020-13-01",
  "2020-01-32",
  "2020-01-00",
  "2020-01-01T24:00:01Z",
  "2020-01-01T00:00:60Z",
  "2020-01-01T00:60:00Z",
  "2020-01-01T25:00:00Z",
  "Jul 32 00:00:00 2026 GMT",
];
for (const s of xs) console.log(s, Date.parse(s));
