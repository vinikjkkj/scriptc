// Where a served dynamic import() sits in the await order, and the shape
// the re-import fence's advice names.
//
// The module body runs AFTER the importer's synchronous code ("sync tail"
// first) and BEFORE the await resumes ("lazy body" then "after import"),
// which is the ordering Node gives. (Node's own loader takes several more
// microtask turns to get there — five to the evaluation and eleven to the
// resume on v25.9.0 — so a microtask chain racing the import interleaves
// differently; the turn count is not a contract and is not compared here.)
//
// The failable work lives in an EXPORTED FUNCTION rather than the module
// body, which is exactly what the re-import fence advises: the failure
// belongs to a call, the module evaluates once, and importing it again
// afterwards is ordinary.
async function step(label: string): Promise<void> { console.log("step " + label); }
async function main(): Promise<void> {
  await step("1");
  console.log("before import");
  const { open } = await import("./lazy.ts");
  console.log("after import");
  await step("2");
  console.log(open("db"));
  try { console.log(open("bad")); } catch (e) { console.log("caught", (e as Error).message); }
  const { open: open2 } = await import("./lazy.ts");
  console.log(open2("again"));
  await step("3");
}
void main();
console.log("sync tail");
