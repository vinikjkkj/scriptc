// Stress the 1 -> 2 -> N growth of a promise's waiter list and the free of its vector at
// settle, under a rc audit: every promise below is awaited by 1, 2, 3, 5, 8 or 40 parked
// async calls, some settle by resolve, some by reject, some by a thenable chain, and a
// batch is dropped unsettled-then-settled after its awaiters were released by Promise.race.
let live = 0;

function defer<T>(): { p: Promise<T>; ok: (v: T) => void; no: (e: unknown) => void } {
  let ok!: (v: T) => void;
  let no!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    ok = a;
    no = b;
  });
  return { p, ok, no };
}

async function leaf(p: Promise<string>, tag: string): Promise<string> {
  live++;
  try {
    const s = await p;
    return tag + s;
  } catch (e) {
    return "E" + String(e);
  } finally {
    live--;
  }
}

async function main(): Promise<void> {
  const counts = [1, 2, 3, 5, 8, 40];
  let total = 0;
  for (let round = 0; round < 50; round++) {
    const batch: Promise<string>[] = [];
    const ds: { p: Promise<string>; ok: (v: string) => void; no: (e: unknown) => void }[] = [];
    for (const n of counts) {
      const d = defer<string>();
      ds.push(d);
      for (let i = 0; i < n; i++) batch.push(leaf(d.p, n + ":" + i + ":"));
    }
    await Promise.resolve();
    if (live !== counts.reduce((a, b) => a + b, 0)) throw new Error("parked " + live);
    ds.forEach((d, i) => (i % 2 === 0 ? d.ok("v" + round) : d.no("x" + round)));
    const out = await Promise.all(batch);
    total += out.length;
    if (round === 49) console.log(out.filter((_, i) => i % 11 === 0).join(" "));
  }
  // race: losers keep their awaiters parked until the loser settles later
  const slow = defer<string>();
  const fast = defer<string>();
  const parked = [leaf(slow.p, "s0"), leaf(slow.p, "s1"), leaf(slow.p, "s2")];
  const winner = Promise.race([slow.p, fast.p]);
  fast.ok("fast");
  console.log(await winner, live);
  slow.ok("slow");
  console.log((await Promise.all(parked)).join(","), live, total);
}

main();
