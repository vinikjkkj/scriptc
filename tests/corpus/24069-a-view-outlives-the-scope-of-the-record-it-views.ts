// A view keeps the record it views alive: it outlives the function that built the record and still reads and writes it.
interface Wide { name: string; n: number; tag: string }
interface Narrow { n: number }
function make(): Narrow {
  const local: Wide = { name: "x".repeat(3), n: 5, tag: "t" + 1 };
  return local;
}
const keep = make();
keep.n += 10;
console.log(keep.n);
const views: Narrow[] = [];
for (let i = 0; i < 3; i++) {
  const w: Wide = { name: "n" + i, n: i, tag: "k" };
  views.push(w);
}
views[1]!.n = 42;
console.log(views.map((v) => v.n).join(","));
