// The EJSON $date read the bson driver does: a string from a document, parsed as a date.
type Doc = { $date: string };
const docs: Doc[] = [
  { $date: "2020-01-01T00:00:00.000Z" },
  { $date: "2020-06-15T08:30:00.250+02:00" },
  { $date: "1969-12-31T23:59:59.999Z" },
];
let total = 0;
for (const d of docs) {
  const ms = Date.parse(d.$date);
  console.log(d.$date, ms);
  if (!Number.isNaN(ms)) total += ms;
}
console.log("total", total);
