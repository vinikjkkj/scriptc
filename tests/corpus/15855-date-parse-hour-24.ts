// The 24th hour: 24:00 is the next day's midnight; 24 with any other minute or second is invalid.
const xs: string[] = [
  "2020-01-01T24:00:00Z",
  "2020-01-01T24:00Z",
  "2020-01-01T24:00:00.000Z",
  "2020-01-01T24:00:01Z",
  "2020-01-01T24:30:00Z",
];
for (const s of xs) console.log(s, Date.parse(s));
