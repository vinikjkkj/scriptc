// Date.parse of explicit ±hh:mm offsets, the hhmm extension, and an offset on a fraction.
const xs: string[] = [
  "2020-01-01T00:00:00+01:00",
  "2020-01-01T00:00:00-08:00",
  "2020-01-01T10:00:00.5+05:30",
  "2020-01-01T00:00:00.000+0100",
  "2020-02-29T12:00:00-23:59",
];
for (const s of xs) console.log(s, Date.parse(s));
