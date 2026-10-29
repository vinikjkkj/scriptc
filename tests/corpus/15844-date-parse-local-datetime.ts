// Date.parse of a date-time with NO offset: LOCAL time, per the spec. The value depends
// on the zone the program runs in, and Node answers in that same zone.
const xs: string[] = [
  "2020-01-01T00:00:00",
  "2020-01-01 00:00:00",
  "2020-1-1",
  "2018-11-04T00:30:00",
  "2019-02-17T23:30:00",
];
for (const s of xs) console.log(s, Date.parse(s));
