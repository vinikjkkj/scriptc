// Promise.all over an untyped array: the first rejection IN TIME rejects the
// combined promise, a later rejection is observed and ignored, and an empty
// untyped array resolves at once. Timer gaps are wide so the order is fixed.
const step = (tag: string, ms: number, fail: boolean) =>
  new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      console.log("step", tag);
      if (fail) reject(new Error("fail " + tag));
      else resolve(tag);
    }, ms);
  });

async function gate(entries: any): Promise<void> {
  try {
    await Promise.all(entries.map((e: any) => e));
    console.log("gate open");
  } catch (err) {
    console.log("gate failed", (err as Error).message);
  }
}

async function main(): Promise<void> {
  await gate([step("slow", 40, false), step("fast-fail", 10, true), step("late-fail", 90, true)]);
  await gate([]);
  await gate([step("ok", 15, false), 3]);
  console.log("main done");
}

main();
