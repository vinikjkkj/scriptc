// Read-only array methods on a tuple whose positions have different types (a settled-results tuple from Promise.allSettled over promises of
// different result types, or a plain [number, string, boolean]). Each was refused (SC2020, "'[...].map' is part of the standard library types
// but has no scriptc lowering yet").
async function num(): Promise<number> { return 5; }
async function str(): Promise<string> { return "five"; }
async function fail(): Promise<boolean> { throw new Error("no"); }

const mixed: [number, string, boolean] = [1, "two", true];
console.log(mixed.map((x) => String(x)).join("|"));
console.log(mixed.join("-"), mixed.length);
console.log(mixed.slice(1).length, mixed.some((x) => x === 1), mixed.every((x) => x !== undefined));
console.log(mixed.filter((x) => typeof x === "string").length);
const labels: string[] = [];
mixed.forEach((x, i) => labels.push(i + ":" + typeof x));
console.log(labels.join(","));
console.log(mixed.reduce<number>((acc, x) => acc + String(x).length, 0));
console.log(mixed.find((x) => typeof x === "boolean"), mixed.findIndex((x) => x === "two"));

async function main(): Promise<void> {
  const settled = await Promise.allSettled([num(), str(), fail(), num()]);
  console.log(settled.map((r) => r.status).join(","));
  console.log(settled.filter((r) => r.status === "fulfilled").length, settled.filter((r) => r.status === "rejected").length);
  settled.forEach((r, i) => console.log(i, r.status));
  console.log(settled.some((r) => r.status === "rejected"), settled.every((r) => r.status === "fulfilled"));
  const values = settled.map((r) => (r.status === "fulfilled" ? String(r.value) : "failed"));
  console.log(values.join("|"));
  const reasons: string[] = [];
  for (const r of settled) if (r.status === "rejected") reasons.push(String(r.reason));
  console.log(reasons.join(";"), settled.slice(1, 3).length);
  const firstOk = settled.find((r) => r.status === "fulfilled");
  console.log(firstOk !== undefined ? firstOk.status : "none");
  console.log(settled.reduce<number>((count, r) => count + (r.status === "fulfilled" ? 1 : 0), 0));
}
main().then(() => console.log("done"));
