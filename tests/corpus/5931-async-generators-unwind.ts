// The unwinding half of async generators: `finally` blocks, `break` out of a
// `for await` (IteratorClose — the loop closes the generator, its finallys
// run, the close's own result is discarded), a body that THROWS, and a body
// whose `await` REJECTS. Each of those reaches the consumer as a rejected
// request promise, so it surfaces at the loop's await, not at the resume.
//
// A generator that dropped a finally, or that let a rejection escape as an
// uncaught error instead of into the loop's try, would still print its
// values — which is why every section prints the cleanup too.
async function* guarded(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    console.log("guarded: finally");
  }
}

async function* throwing(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    throw new Error("body-threw");
  } finally {
    console.log("throwing: finally");
  }
}

async function rejecting(): Promise<number> {
  throw new Error("await-rejected");
}

async function* awaitRejects(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    const v = await rejecting();
    yield v;
  } finally {
    console.log("awaitRejects: finally");
  }
}

// A finally that itself awaits: the close has to WAIT for it, or the loop
// would continue past a cleanup that had not finished.
async function* slowCleanup(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    yield 2;
  } finally {
    await Promise.resolve();
    console.log("slowCleanup: finally after await");
  }
}

async function main(): Promise<void> {
  for await (const v of guarded()) console.log("drain", v);
  console.log("--- full drain done");

  for await (const v of guarded()) {
    console.log("brk", v);
    if (v === 2) break;
  }
  console.log("--- break done");

  for await (const v of guarded()) {
    if (v === 1) continue;
    console.log("cont", v);
  }
  console.log("--- continue done");

  try {
    for await (const v of throwing()) console.log("thr", v);
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  console.log("--- throw done");

  try {
    for await (const v of awaitRejects()) console.log("rej", v);
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  console.log("--- reject done");

  for await (const v of slowCleanup()) {
    console.log("slow", v);
    if (v === 1) break;
  }
  console.log("--- slow cleanup done");
}

main();
