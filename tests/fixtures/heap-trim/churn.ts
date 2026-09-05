/* Take a large transient heap, drop it, then idle.
 *
 * The shape is the one a history sync has: a burst of allocation that is
 * entirely garbage by the end of it, followed by a quiet loop that is
 * exactly where the idle-seam trim runs its windows. KEEP survivors are
 * held on purpose — one live block in KEEP pins its whole heap subsegment,
 * which is the condition under which the Win32 heap keeps the pages, and
 * a churn with no survivors at all would let free() return everything by
 * itself and prove nothing about the trim.
 *
 * Read by tests/harness/heap-trim.test.ts, which drives the two arms with
 * SCR_HEAP_TRIM_MS and reads the [heaptrim] stat lines. The program prints
 * only its own completion, so a failure in the test is always about the
 * trim and never about this file's output. */
const BLOCKS = Number(process.env["CHURN_BLOCKS"] !== undefined ? process.env["CHURN_BLOCKS"] : "40000");
const LEN = Number(process.env["CHURN_LEN"] !== undefined ? process.env["CHURN_LEN"] : "300");
const KEEP = Number(process.env["CHURN_KEEP"] !== undefined ? process.env["CHURN_KEEP"] : "20");
const TAIL_MS = Number(process.env["CHURN_TAIL_MS"] !== undefined ? process.env["CHURN_TAIL_MS"] : "1500");

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, ms); });
}

async function main(): Promise<void> {
  const survivors: string[] = [];
  let sink = 0;
  for (let round = 0; round < 4; round++) {
    const held: string[] = [];
    for (let i = 0; i < BLOCKS; i++) {
      const s = "x".repeat(LEN) + String(round) + ":" + String(i);
      held.push(s);
      if (i % KEEP === 0) survivors.push(s);
    }
    sink += held.length;
    held.length = 0;
    await sleep(1);
  }
  console.log("churn " + String(sink) + " " + String(survivors.length));
  await sleep(TAIL_MS);
  console.log("done");
}

main().then(() => {}, (e: unknown) => { console.log("err " + String(e)); });
