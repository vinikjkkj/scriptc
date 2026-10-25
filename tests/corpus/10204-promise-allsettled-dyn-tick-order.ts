// Microtask order around an allSettled over untyped entries: a plain promise
// chain runs alongside the combinator, and each side logs as it settles. The
// relative order of the two chains is fixed by Node's tick counts.
const resolved = (tag: string) => Promise.resolve(tag);

function race(entries: any): void {
  const combined = Promise.allSettled(entries.map((e: any) => e));
  combined.then((results) => {
    console.log("combined", results.length);
  });
  resolved("r1")
    .then((v) => console.log("chain", v))
    .then(() => console.log("chain two"));
  console.log("race armed");
}

async function main(): Promise<void> {
  race([resolved("a"), 5, resolved("b")]);
  await new Promise<void>((done) => setTimeout(done, 5));
  race([]);
  await new Promise<void>((done) => setTimeout(done, 5));
  console.log("main end");
}

main();
