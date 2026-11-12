// Promise.all / race / allSettled / any over entries that are still pending when the combinator is built: each parked entry is a callback on the
// source (the lazily allocated callback list of the promise). Some combinators settle, some are left waiting on a source that never settles at exit.
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function later<T>(ms: number, v: T): Promise<T> { await wait(ms); return v; }
async function laterFail<T>(ms: number, why: string): Promise<T> { await wait(ms); throw new Error(why); }
function never<T>(): Promise<T> { return new Promise<T>(() => {}); }

async function main(): Promise<void> {
  // wide fan-in over pending numbers
  const many: Promise<number>[] = [];
  for (let i = 0; i < 200; i++) many.push(later(i % 4, i));
  const all = await Promise.all(many);
  console.log("all", all.length, all.reduce((a, b) => a + b, 0));
  // tuple of heterogeneous pending entries
  const tup = await Promise.all([later(2, 1), later(1, "two"), later(0, true), later(1, { k: 4 })]);
  console.log("tuple", tup[0], tup[1], tup[2], tup[3].k);
  // race: the first settler wins, losers keep their callbacks until they settle
  const winner = await Promise.race([later(5, "slow"), later(1, "fast"), later(3, "mid")]);
  console.log("race", winner);
  const losers = await Promise.race([laterFail<string>(1, "lost"), later(4, "late")]).catch((e) => "caught " + (e instanceof Error ? e.message : "?"));
  console.log("race rejected", losers);
  // allSettled with mixed outcomes
  const st = await Promise.allSettled([later(1, 10), laterFail<number>(2, "bad"), later(0, 30)]);
  console.log("settled", st.map((s) => (s.status === "fulfilled" ? "ok:" + s.value : "no:" + (s.reason instanceof Error ? s.reason.message : "?"))).join(","));
  // the same source consumed by several combinators at once
  const shared = later(2, 7);
  const x = await Promise.all([shared, shared]);
  const y = await Promise.race([shared, never<number>()]);
  const z = await Promise.allSettled([shared]);
  console.log("shared", x.join("+"), y, z[0]!.status);
  // combinators left waiting forever at exit: they hold callbacks on a source that never settles
  void Promise.all([never<number>(), later(1, 2)]).then(() => console.log("unreachable"));
  void Promise.race([never<string>(), never<string>()]).then(() => console.log("unreachable"));
  void Promise.allSettled([never<boolean>()]).then(() => console.log("unreachable"));
  console.log("done");
}
main();
