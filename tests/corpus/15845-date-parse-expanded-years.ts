// Date.parse of expanded years: six-digit signed years, and the exact TimeClip edges.
const xs: string[] = [
  "+010000-01-01T00:00:00.000Z",
  "-000001-01-01T00:00:00Z",
  "+275760-09-13T00:00:00Z",
  "+275760-09-13T00:00:00.001Z",
  "-271821-04-20T00:00:00Z",
  "-271821-04-19T23:59:59.999Z",
  "-000000-01-01T00:00:00Z",
  "+275761-01-01",
];
for (const s of xs) console.log(s, Date.parse(s));
