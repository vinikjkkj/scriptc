// A string-or-number union, narrowed to string before Date.parse.
function read(v: string | number): number {
  if (typeof v === "string") return Date.parse(v);
  return v;
}
console.log(read("2020-01-01T00:00:00.000Z"));
console.log(read(42));
console.log(read("bogus"));
console.log(read("Tue, 01 Jan 2019 00:00:00 GMT"));
