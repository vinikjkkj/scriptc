// Unicode white space and separators: the same whitespace set V8 skips, escaped so the
// source stays ASCII.
const xs: string[] = [
  "2020 -01-01",
  "　2020-01-02",
  "2020-01-01 T00:00:00Z",
  "12 Jan 2000",
  "2020-01-01T00:00:00.000​Z",
  "Jan 😀 2 2019",
];
for (const s of xs) console.log(JSON.stringify(s), Date.parse(s));
