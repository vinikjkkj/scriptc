/* A burst of concurrent async chains, then an idle tail.
 *
 * The shape is the one a history sync has and an idle server does not:
 * thousands of awaits in flight at once, then nothing. Each chain is a
 * nest of async calls, so DEPTH+1 fiber stacks are live per chain and the
 * pool fills to its cap. The tail is what the decay windows run in.
 *
 * Read by tests/harness/fiber-pool-decay.test.ts, which drives the two
 * arms with SCR_FIBER_POOL_DECAY_MS and reads the [fiberpool] stat lines.
 * The program prints only its own completion, so a failure in the test is
 * always about the pool and never about this file's output. */
const WIDTH = Number(process.env["BURST_WIDTH"] !== undefined ? process.env["BURST_WIDTH"] : "200");
const DEPTH = Number(process.env["BURST_DEPTH"] !== undefined ? process.env["BURST_DEPTH"] : "6");
const TAIL_MS = Number(process.env["BURST_TAIL_MS"] !== undefined ? process.env["BURST_TAIL_MS"] : "1500");

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, ms); });
}
async function deep(n: number, tag: number): Promise<number> {
  if (n <= 0) { await sleep(1); return tag; }
  return (await deep(n - 1, tag)) + 1;
}
async function main(): Promise<void> {
  const ps: Promise<number>[] = [];
  for (let i = 0; i < WIDTH; i++) ps.push(deep(DEPTH, i));
  const rs = await Promise.all(ps);
  console.log("burst " + String(rs.length));
  await sleep(TAIL_MS);
  console.log("done");
}
main().then(() => {}, (e: unknown) => { console.log("err " + String(e)); });
