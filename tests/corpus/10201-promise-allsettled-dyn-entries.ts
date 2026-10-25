// Promise.allSettled over an untyped array: fulfilled and rejected entries
// interleaved with plain values. Every entry is reported in input order, and
// the rejections do not short-circuit the others.
const ok = (tag: string, ms: number) =>
  new Promise<string>((resolve) => {
    setTimeout(() => {
      console.log("resolve", tag);
      resolve(tag);
    }, ms);
  });

const bad = (msg: string, ms: number) =>
  new Promise<string>((_resolve, reject) => {
    setTimeout(() => {
      console.log("reject", msg);
      reject(new Error(msg));
    }, ms);
  });

async function report(entries: any): Promise<void> {
  const results = await Promise.allSettled(entries.map((e: any) => e));
  console.log("count", results.length);
  for (const r of results) {
    if (r.status === "rejected") console.log("err", (r.reason as Error).message);
    else console.log("ok", r.value);
  }
}

async function main(): Promise<void> {
  await report([ok("x", 40), bad("boom", 10), 9, ok("y", 20)]);
  await report([]);
  console.log("end");
}

main();
