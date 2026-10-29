// Date.parse of fractional seconds of 1 to 9 digits: the first three significant digits count.
const xs: string[] = [
  "2000-01-01T00:00:00.5Z",
  "2000-01-01T00:00:00.05Z",
  "2000-01-01T00:00:00.123Z",
  "2000-01-01T00:00:00.1234Z",
  "2000-01-01T00:00:00.0005Z",
  "2000-01-01T00:00:00.9999Z",
  "2000-01-01T00:00:00.123456789Z",
];
for (const s of xs) console.log(s, Date.parse(s));
