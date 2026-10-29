// Date.parse of date-times ending in Z: seconds, minutes-only, lowercase t and z.
const xs: string[] = [
  "2020-01-01T00:00:00.000Z",
  "2020-01-01T00:00:00Z",
  "2020-01-01T12:34Z",
  "2020-01-01t00:00:00z",
  "2026-07-17T12:34:56Z",
];
for (const s of xs) console.log(s, Date.parse(s));
