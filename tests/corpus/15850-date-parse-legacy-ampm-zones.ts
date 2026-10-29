// Date.parse of the legacy clock and zone words: AM/PM, parentheses, and abbreviations.
const xs: string[] = [
  "12 PM",
  "12:30 am",
  "Mar 25 2010 3:45:01 pm",
  "2019-01-02T10:00 PM",
  "2019-02-17 23:30:00.123 PDT",
  "Tue Feb 01 2022 00:00:00 GMT+0000 (Coordinated Universal Time)",
  "(comment) 2020-01-01",
];
for (const s of xs) console.log(s, Date.parse(s));
