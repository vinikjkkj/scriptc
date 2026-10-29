// Day-of-month rollovers: a day past the end of the month rolls into the next month (V8),
// a leap day is valid only in leap years.
const xs: string[] = [
  "2020-02-29T12:00:00Z",
  "2019-02-29T12:00:00Z",
  "2020-02-30",
  "2026-04-31",
  "Feb 30 12:00:00 2024 GMT",
  "2024-02-30T12:00:00Z",
];
for (const s of xs) console.log(s, Date.parse(s));
