// `await Promise.all(ps)` as a STATEMENT, over entries whose payload is the
// checked-dynamic value -- zapo's messaging send fan-out
// (`const promises = new Array<Promise<unknown>>(n); ...; await
// Promise.all(promises)`).
//
// `Promise<unknown>[]` is HOMOGENEOUS: it is not the tuple case. It reaches
// the combinator's fence because the COMBINED result is `unknown[]`, and an
// array whose element is dyn IS the dyn (types.ts' collapse -- ScrArr has no
// dyn element kind), so there is no static values array to pre-size. In a
// DISCARDED position nothing reads the payload, so the void-collapsing form
// is exact and not an approximation -- which this program is here to prove:
// it still subscribes to every entry, still settles when the LAST one does,
// and the FIRST rejection still wins.
const order: string[] = [];

async function later(tag: string, ticks: number): Promise<unknown> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
  order.push(tag);
  return tag;
}
async function boom(tag: string, ticks: number): Promise<unknown> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
  order.push(`throw:${tag}`);
  throw new Error(tag);
}

async function main(): Promise<void> {
  // 1. The zapo spelling: a pre-sized array filled by index.
  const promises = new Array<Promise<unknown>>(3);
  for (let i = 0; i < 3; i += 1) promises[i] = later(`p${i}`, 3 - i);
  await Promise.all(promises);
  // Every entry ran, and the await resumed only after the LAST one.
  console.log("1:", order.join(","));

  // 2. The annotated-literal spelling, with an ALREADY-RESOLVED entry and a
  //    slow one: settling waits for the slow one.
  order.length = 0;
  const mixed: Promise<unknown>[] = [Promise.resolve("now"), later("slow", 4)];
  await Promise.all(mixed);
  console.log("2:", order.join(","));

  // 3. The EMPTY array: fulfils immediately, one microtask hop.
  const none: Promise<unknown>[] = [];
  let hopped = false;
  const hop = Promise.resolve().then(() => {
    hopped = true;
  });
  await Promise.all(none);
  await hop;
  console.log("3:", hopped);

  // 4. ONE ENTRY REJECTS: the await throws the first rejection in
  //    SETTLEMENT order, and the later entries still run (subscribe-to-
  //    everything) without an unhandled-rejection report.
  order.length = 0;
  const withBad: Promise<unknown>[] = [later("a", 5), boom("b", 1), boom("c", 3)];
  try {
    await Promise.all(withBad);
    console.log("4: no throw");
  } catch (e) {
    console.log("4:", e instanceof Error ? e.message : "?");
  }
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  console.log("4 order:", order.join(","));

  // 5. EVERY entry already settled: still one hop, still ordered.
  order.length = 0;
  const settled: Promise<unknown>[] = [later("s0", 0), later("s1", 0)];
  await Promise.all(settled);
  console.log("5:", order.join(","));

  // 6. The same construct with a REPRESENTABLE payload keeps its array
  //    result -- the collapse must not have eaten this one.
  const nums: Promise<number>[] = [Promise.resolve(1), Promise.resolve(2)];
  const got = await Promise.all(nums);
  console.log("6:", got.length, got[0], got[1]);

  // 7. And the heterogeneous LITERAL keeps its tuple result.
  const [x, y] = await Promise.all([Promise.resolve(1), Promise.resolve("two")]);
  console.log("7:", x, y);

  // 8. A void-payload fan-out in the same discarded position -- the shape
  //    the collapse was already used for, unchanged.
  order.length = 0;
  const voids: Promise<void>[] = [];
  for (let i = 0; i < 2; i += 1) {
    voids.push(
      (async () => {
        await Promise.resolve();
        order.push(`v${i}`);
      })(),
    );
  }
  await Promise.all(voids);
  console.log("8:", order.join(","));
}

void main();
