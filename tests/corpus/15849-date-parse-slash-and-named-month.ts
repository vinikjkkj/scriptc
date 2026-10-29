// Date.parse of slash dates and month-name dates, including the two-digit-year window.
const xs: string[] = [
  "2019/01/02",
  "1/2",
  "Jan 2",
  "Jan 2 2019",
  "Jan 2019",
  "12/31/1999 23:59:59",
  "1/1/49",
  "1/1/50",
  "1/1/99",
];
for (const s of xs) console.log(s, Date.parse(s));
