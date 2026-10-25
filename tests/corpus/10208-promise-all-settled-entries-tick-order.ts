// Promise.all over promises that are already fulfilled: Node resumes the
// awaiter one turn after the last entry's reaction, so a plain chain started
// at the same time logs in between.
const resolved = (tag: string) => Promise.resolve(tag);

async function run(): Promise<void> {
  await Promise.all([resolved("a"), resolved("b")]);
  console.log("all done");
}

run();
resolved("r1")
  .then((v) => console.log("chain", v))
  .then(() => console.log("chain two"))
  .then(() => console.log("chain three"));
console.log("armed");
