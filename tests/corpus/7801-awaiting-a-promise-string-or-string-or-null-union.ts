// Awaiting a union with ONE promise arm whose other arms are not exactly the
// promise's payload (`Promise<string> | string | null`, a plugin hook's return),
// reached through curried and flat slots. The promise arm parks, every other
// arm takes one hop and yields itself.
type Hook = (o: { n: number }) => (d: string) => Promise<string> | string | null;
const hooks: { [k: string]: Hook } = {
  a: (o) => async (d) => d + o.n,
  b: () => (d) => d.toUpperCase(),
  c: () => () => null,
};
type Flat = (d: string) => Promise<string> | string | null;
const flat: { [k: string]: Flat } = { a: async (d) => d + "!", b: (d) => d };
async function main(): Promise<void> {
  for (const k of ["a", "b", "c"]) {
    const r = await hooks[k]!({ n: 1 })("x");
    console.log("hook", k, r === null ? "null" : r);
  }
  for (const k of ["a", "b"]) {
    const r = await flat[k]!("y");
    console.log("flat", k, r === null ? "null" : r);
  }
}
main();
