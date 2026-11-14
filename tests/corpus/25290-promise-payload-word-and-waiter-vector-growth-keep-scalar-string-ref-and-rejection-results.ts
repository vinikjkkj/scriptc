// A promise keeps ONE payload word for an f64, a bool or an owned pointer, chosen by its kind, and its waiter vector doubles at 4, 8, 16, 32...
// without storing its capacity. Settled scalar, string, record, array, void and rejected promises are read back across the sizes the waiter vector
// grows through (1, 2, 3, 4, 5, 8, 9, 16, 17, 33, 100 awaiters on one pending promise), through Promise.all / race and through then chains.
interface Rec { id: number; tag: string }
function later<T>(v: T, ms: number): Promise<T> { return new Promise<T>((r) => setTimeout(() => r(v), ms)); }
function bad(n: number): Promise<number> { return new Promise<number>((_, j) => setTimeout(() => j(new Error("boom" + n)), 1)); }
async function num(i: number): Promise<number> { await later(0, 0); return i * 1.5; }
async function flag(i: number): Promise<boolean> { await later(0, 0); return i % 2 === 0; }
async function str(i: number): Promise<string> { await later(0, 0); return "s" + i; }
async function rec(i: number): Promise<Rec> { await later(0, 0); return { id: i, tag: "r" + i }; }
async function arr(i: number): Promise<number[]> { await later(0, 0); return [i, i + 1, i + 2]; }
async function voidp(): Promise<void> { await later(0, 0); }
async function main(): Promise<void> {
  let acc = 0; let sacc = "";
  for (let i = 0; i < 40; i++) {
    acc += await num(i);
    if (await flag(i)) acc += 1;
    sacc += await str(i);
    const r = await rec(i); acc += r.id + r.tag.length;
    const a = await arr(i); acc += a[0] + a[1] + a[2];
    await voidp();
  }
  console.log(acc, sacc.length);
  // many waiters on ONE pending promise: 1, 2, 3, 4, 5, 8, 9, 16, 17, 33 awaiters (the waiter vector grows 4, 8, 16, 32, 64)
  for (const n of [1, 2, 3, 4, 5, 8, 9, 16, 17, 33, 100]) {
    let release!: (v: number) => void;
    const gate = new Promise<number>((r) => { release = r; });
    const outs: Promise<number>[] = [];
    for (let k = 0; k < n; k++) outs.push((async () => (await gate) + k)());
    setTimeout(() => release(1000), 1);
    const vals = await Promise.all(outs);
    let t = 0; for (const v of vals) t += v;
    console.log("waiters", n, t);
  }
  // rejections: scalar-kind settled promise vs a rejected one with an object reason
  let caught = 0;
  for (let i = 0; i < 20; i++) { try { await bad(i); } catch (e) { caught += (e as Error).message.length; } }
  console.log("caught", caught);
  // combinators
  const all = await Promise.all([num(1), num(2), num(3)]);
  console.log(all.join(","));
  const race = await Promise.race([later("a", 5), later("b", 1)]);
  console.log(race);
  const allS = await Promise.all([str(1), str(2)]);
  console.log(allS.join(","));
  const raceNum = await Promise.race([num(7), later(99.5, 10)]);
  console.log(raceNum);
  // an already-settled scalar promise read twice and a thenable chain
  const p = num(3);
  console.log(await p, await p);
  const chained = await num(2).then((x) => x + 1).then((y) => y * 2);
  console.log(chained);
}
main().then(() => console.log("done"));
