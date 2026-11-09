// JSON.stringify of a value whose type is not statically JSON-safe ([Error | null, unknown][] | null, what a pipeline's exec resolves) goes through the
// dynamic path and answers what Node answers; it was refused with SC1090.
async function results(ok: boolean): Promise<[Error | null, unknown][] | null> {
  return ok ? [[null, 1], [null, "x"], [null, { f: "v" }]] : null;
}
async function main(): Promise<void> {
  const a = await results(true);
  const b = await results(false);
  console.log(JSON.stringify(a), JSON.stringify(b));
  console.log(a === null ? "null" : a.length, JSON.stringify([a, 2]));
}
main();
