// Promise.all over untyped entries that are already fulfilled: the awaiter
// resumes one turn after the entries' reactions, so a chain started in the same
// synchronous run logs its first step before the awaiter does.
const resolved = (tag: string) => Promise.resolve(tag);

async function run(entries: any): Promise<void> {
  await Promise.all(entries.map((e: any) => e));
  console.log("dyn all done");
}

run([resolved("a"), 5]);
resolved("r1")
  .then((v) => console.log("chain", v))
  .then(() => console.log("chain two"))
  .then(() => console.log("chain three"));
console.log("armed");
