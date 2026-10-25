// Promise.all over an untyped array: the first rejection IN TIME rejects the
// combined promise, a later rejection is observed and ignored, and an empty
// untyped array resolves at once. The second gate starts after the first one
// rejects and spins the thread for a while, so its timers are registered late:
// the timer gaps are wide so that the order does not depend on wall-clock jitter,
// and the still-pending timers keep the process alive until they fire.
const step = (tag: string, ms: number, fail: boolean) =>
  new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      console.log("step", tag);
      if (fail) reject(new Error("fail " + tag));
      else resolve(tag);
    }, ms);
  });

function busy(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // a deliberately slowed thread between the first rejection and the next gate
  }
}

async function gate(entries: any): Promise<void> {
  try {
    await Promise.all(entries.map((e: any) => e));
    console.log("gate open");
  } catch (err) {
    console.log("gate failed", (err as Error).message);
  }
}

async function main(): Promise<void> {
  await gate([step("slow", 400, false), step("fast-fail", 10, true), step("late-fail", 900, true)]);
  busy(60);
  await gate([]);
  await gate([step("ok", 15, false), 3]);
  console.log("main done");
}

main();
