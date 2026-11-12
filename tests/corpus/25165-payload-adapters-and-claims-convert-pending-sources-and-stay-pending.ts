// A promise flowing into a promise slot with a different payload type is adapted (a memo on the source plus a claim parked on its reaction list while
// the source is pending). Pending sources, settled sources, rejected sources, the same source adapted twice, and sources never settled at exit.
type A = { readonly kind: "a"; readonly a: number };
type B = { readonly kind: "b"; readonly b: string };
type Wide = { a: number; b: string; extra: number };
type Narrow = { a: number; b: string };
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function widen(p: Promise<A>): Promise<A | B> { return p; }
function widenAgain(p: Promise<A>): Promise<A | B | null> { return p; }
function narrow(p: Promise<Wide>): Promise<Narrow> { return p; }
async function lateA(ms: number, a: number): Promise<A> { await wait(ms); return { kind: "a", a }; }
async function lateWide(ms: number, a: number): Promise<Wide> { await wait(ms); return { a, b: "w" + a, extra: a * 2 }; }
async function failA(ms: number): Promise<A> { await wait(ms); throw new Error("failA"); }

async function main(): Promise<void> {
  const out: string[] = [];
  const pend: Promise<A | B>[] = [];
  for (let i = 0; i < 100; i++) pend.push(widen(lateA(i % 3, i)));
  for (const p of pend) { const v = await p; out.push(v.kind === "a" ? String(v.a) : v.b); }
  console.log(out.length, out.slice(0, 5).join(","), out[99]);
  // the same source adapted through two slots while it is still pending
  const src = lateA(3, 5);
  const w1 = widen(src), w2 = widenAgain(src);
  const [r1, r2] = await Promise.all([w1, w2]);
  console.log("two adapters", r1.kind, r2 !== null && r2.kind, w1 === widen(src));
  // a rejected source reaches the adapted promise untouched
  try { await widen(failA(2)); console.log("no throw"); } catch (e) { console.log("rejected", (e as Error).message); }
  // narrow views of pending wide records, written through
  const wides: Wide[] = [];
  const views: Promise<Narrow>[] = [];
  for (let i = 0; i < 50; i++) {
    const p = lateWide(i % 2, i);
    views.push(narrow(p));
    wides.push(await p);
  }
  let agree = 0;
  for (let i = 0; i < 50; i++) { const v = await views[i]!; v.a += 1; if (wides[i]!.a === i + 1 && v.b === "w" + i) agree++; }
  console.log("views agree", agree);
  // adapted promises whose sources never settle: they are still parked at exit
  const stuck: Promise<A | B>[] = [];
  for (let i = 0; i < 20; i++) stuck.push(widen(new Promise<A>(() => {})));
  void Promise.all(stuck).then(() => console.log("unreachable"));
  console.log("exit with", stuck.length, "pending adapters");
}
main();
