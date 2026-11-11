// `for (const [name, fn] of [["a", f], ["b", g]] as const)` where f and g have different signatures (here: different result types). The
// element tuples differ in their function position, so the loop variable is a union of tuples and `fn` a union of function types, which TypeScript
// calls as one function with a union result. It was refused (SC2020 / SC1031).
function double(n: number): number { return n * 2; }
function label(n: number): string { return "n=" + n; }
function isEven(n: number): boolean { return n % 2 === 0; }
function pair(n: number): number[] { return [n, n + 1]; }

for (const [name, fn] of [["double", double], ["label", label]] as const) {
  console.log(name, fn(21), typeof fn(21));
}
for (const [name, fn] of [["double", double], ["label", label], ["isEven", isEven]] as const) {
  const out = fn(4);
  console.log(name, out, typeof out);
}
const table = [["pair", pair], ["label", label], ["double", double]] as const;
const results: string[] = [];
for (const [name, fn] of table) {
  results.push(name + "=" + String(fn(3)));
}
console.log(results.join(";"));

async function fetchNumber(): Promise<number> { return 41; }
async function fetchText(): Promise<string> { return "text"; }
async function main(): Promise<void> {
  for (const [name, load] of [["number", fetchNumber], ["text", fetchText]] as const) {
    const value = await load();
    console.log(name, value, typeof value);
  }
}
main().then(() => console.log("done"));

const handlers = [["inc", (n: number) => n + 1], ["name", (n: number) => "id" + n]] as const;
for (const [key, run] of handlers) console.log(key, run(1));
