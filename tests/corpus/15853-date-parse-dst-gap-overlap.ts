// Local date-times in a DST gap (skipped) and a DST overlap (repeated): the spec's
// disambiguation. Node and the binary share the zone the program runs in.
const xs: string[] = [
  "2018-11-04T00:30:00",
  "2018-11-04T01:30:00",
  "2019-02-17T00:30:00",
  "2019-02-17T23:30:00",
  "2021-03-14T02:30:00",
  "2021-11-07T01:30:00",
];
for (const s of xs) console.log(s, Date.parse(s));
