// Live pending promises of every payload kind (f64, bool, string, a cycle-capable record, void), settled in a scrambled order, rejected with each kind,
// and a few left unsettled at exit. Each kind keeps its payload in a different member of the promise (the scalar word, the string or the interned
// retain/release/trace triple), so every one is read back after the settle.
interface Node3 { id: number; label: string; self: Node3 | null }
const N = 300;
const nums: Promise<number>[] = [], numRes: ((v: number) => void)[] = [];
const flags: Promise<boolean>[] = [], flagRes: ((v: boolean) => void)[] = [];
const strs: Promise<string>[] = [], strRes: ((v: string) => void)[] = [];
const nodes: Promise<Node3>[] = [], nodeRes: ((v: Node3) => void)[] = [];
const voids: Promise<void>[] = [], voidRes: (() => void)[] = [];
for (let i = 0; i < N; i++) {
  nums.push(new Promise<number>((r) => numRes.push(r)));
  flags.push(new Promise<boolean>((r) => flagRes.push(r)));
  strs.push(new Promise<string>((r) => strRes.push(r)));
  nodes.push(new Promise<Node3>((r) => nodeRes.push(r)));
  voids.push(new Promise<void>((r) => voidRes.push(r)));
}
async function main(): Promise<void> {
  let sum = 0, trues = 0, chars = 0, selfs = 0, vcount = 0;
  async function reader(i: number): Promise<void> {
    sum += (await nums[i]!) * 2;
    if (await flags[i]!) trues++;
    chars += (await strs[i]!).length;
    const n = await nodes[i]!;
    if (n.self === n && n.label === "n" + i) selfs++;
    await voids[i]!;
    vcount++;
  }
  const readers: Promise<void>[] = [];
  for (let i = 0; i < N - 5; i++) readers.push(reader(i)); // the last five slots have no reader and stay unsettled
  for (let k = 0; k < N - 5; k++) {
    const i = (k * 37) % (N - 5);
    numRes[i]!(i + 0.5);
    if (k % 7 === 0) await 0;
    flagRes[i]!(i % 3 === 0);
    strRes[i]!("s" + i);
    const nd: Node3 = { id: i, label: "n" + i, self: null };
    nd.self = nd;
    nodeRes[i]!(nd);
    voidRes[i]!();
  }
  // the last five: settled but never awaited, and five pending forever
  for (let i = N - 5; i < N - 2; i++) { numRes[i]!(1); flagRes[i]!(true); strRes[i]!("x"); voidRes[i]!(); }
  await Promise.all(readers);
  console.log(sum, trues, chars, selfs, vcount);

  // rejections observed late, and a rejected promise nobody awaits until after other work
  const rej: Promise<number>[] = [];
  for (let i = 0; i < 5; i++) rej.push(Promise.reject(new Error("e" + i)));
  const seen: string[] = [];
  for (const p of rej) {
    try { await p; seen.push("ok"); } catch (e) { seen.push(e instanceof Error ? e.message : "?"); }
  }
  console.log(seen.join("|"));
  console.log("pending at exit", N - (N - 2));
}
main();
