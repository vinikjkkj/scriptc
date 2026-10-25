// Promise.all over an untyped (checked-dynamic) array: pending promises,
// plain values and undefined mixed in one array, the combined result
// discarded. Node adopts every promise and passes every value through; the
// first rejection in TIME is the one that counts.
const later = (tag: string, ms: number) =>
  new Promise<string>((resolve) => {
    setTimeout(() => {
      console.log("settle", tag);
      resolve(tag);
    }, ms);
  });

async function settleAll(entries: any): Promise<void> {
  const mapped = entries.map((e: any) => e);
  await Promise.all(mapped);
  console.log("all settled", mapped.length);
}

async function main(): Promise<void> {
  console.log("start");
  await settleAll([later("a", 50), later("b", 10), 7, undefined]);
  console.log("after a and b");
  const pending = settleAll([later("c", 30), later("d", 20)]);
  console.log("pending");
  await pending;
  await settleAll([]);
  console.log("done");
}

main();
