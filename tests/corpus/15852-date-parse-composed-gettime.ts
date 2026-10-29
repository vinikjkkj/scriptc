// new Date(string).getTime() is the same parser as Date.parse: both answers agree on
// every form, and the composed read keeps its NaN for the invalid ones.
const xs: string[] = [
  "2026-07-17T00:00:00.000Z",
  "2026-07-17",
  "2026-07-17T12:00:00+05:30",
  "Jul  1 00:00:00 2026 GMT",
  "2019/01/02",
  "bogus",
];
for (const s of xs) console.log(new Date(s).getTime(), Date.parse(s));
