// number|string, boolean|null and number|string|boolean unions: scalar arms (f64, bool) next to a ref arm (string), held in arrays, returned from
// concurrent coroutines through a heterogeneous Promise.all, widened into a larger union (a retag), aliased by several holders, and kept alive across
// cycle-collector passes. Every printed value is the one Node prints; under --sanitize any leak or use-after-free of a small box shows.
type NS = number | string;
type BN = boolean | null;
type NSB = number | string | boolean;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
class Ring { next: Ring | null = null; v = 0 }
function churn(n: number): number {
  let s = 0;
  for (let i = 0; i < 30; i++) { const a = new Ring(); const b = new Ring(); a.next = b; b.next = a; a.v = i + n; s += a.v; }
  return s;
}
async function num(n: number): Promise<NS> { await wait(n % 3); return n % 2 === 0 ? n * 1.5 : "s" + n; }
async function flag(n: number): Promise<BN> { await wait((n + 1) % 3); return n % 3 === 0 ? null : n % 2 === 0; }
async function rec(n: number): Promise<{ id: number; tag: NS }> { await wait((n + 2) % 3); return { id: n, tag: n % 2 === 0 ? n : "t" + n }; }
function widen(x: NS): NSB { return x; }
function describe(x: NSB): string { return typeof x === "number" ? "n" + x : typeof x === "string" ? "s" + x : "b" + x; }
async function work(n: number): Promise<string> {
  const t = await Promise.all([num(n), flag(n), rec(n)]);
  const a = t[0]; const b = t[1]; const c = t[2];
  const alias = a;
  const arr: NS[] = [a, alias, c.tag];
  const wide: NSB[] = arr.map(widen);
  wide.push(b === null ? false : b);
  await wait(n % 2);
  churn(n);
  const out = wide.map(describe).join(",") + "|" + (b === null ? "null" : String(b)) + "|" + (a === alias);
  await wait(1);
  churn(n + 1);
  return out;
}
async function main(): Promise<void> {
  let h = 0;
  const sample: string[] = [];
  for (let round = 0; round < 4; round++) {
    const rs = await Promise.all(Array.from({ length: 500 }, (_, i) => work(round * 500 + i)));
    for (let i = 0; i < rs.length; i++) {
      const s = rs[i]!;
      for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
      if (i % 97 === 0) sample.push(s);
    }
  }
  console.log(h, sample.join(" ; "));
}
main();
