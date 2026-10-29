// Date.parse at the TimeClip boundary (±8.64e15 ms) and one millisecond past it.
const xs: string[] = [
  "+275760-09-13T00:00:00.000Z",
  "+275760-09-13T00:00:00.001Z",
  "-271821-04-20T00:00:00.000Z",
  "-271821-04-19T23:59:59.999Z",
  "1970-01-01T00:00:00.000Z",
];
let count = 0;
for (const s of xs) {
  const v = Date.parse(s);
  if (!Number.isNaN(v)) count++;
  console.log(s, v);
}
console.log("valid", count);
