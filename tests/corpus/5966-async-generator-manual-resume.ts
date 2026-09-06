// Driving an async generator by HAND — `await g.next()`, `await g.return()`,
// `await g.throw(e)` — instead of through `for await`. The protocol is the
// same fiber protocol the desugar drives; what is new is that the consumer
// writes the loop, so every step is observable: the record's `done` and
// `value`, the completion value the last resume carries, and the ORDERING
// of the body's own output against the consumer's.
//
// Ordering is the point, not decoration. An async generator that answered
// the right values in the wrong turns would still print the right numbers
// under a loop that only logged them, so the body logs between yields.

async function* counter(): AsyncGenerator<number, string, undefined> {
  console.log("gen: start");
  yield 1;
  console.log("gen: after 1");
  yield 2;
  console.log("gen: after 2");
  return "finished";
}

async function drainByHand(): Promise<void> {
  const g = counter();
  console.log("consumer: constructed (nothing ran)");
  while (true) {
    const r = await g.next();
    if (r.done === true) {
      console.log("consumer: done with", r.value);
      break;
    }
    console.log("consumer: got", r.value);
  }
  // A resume of an already-DONE generator: { value: undefined, done: true }.
  const after = await g.next();
  console.log("consumer: after done", after.done, after.value);
}

// `.return()` mid-stream: the body's `finally` runs, and the record carries
// the requested completion value.
async function* withFinally(): AsyncGenerator<number, string, undefined> {
  try {
    yield 10;
    yield 20;
    return "ran to the end";
  } finally {
    console.log("gen: finally");
  }
}

async function earlyReturn(): Promise<void> {
  const g = withFinally();
  const first = await g.next();
  console.log("early: first", first.done, first.value);
  const closed = await g.return("closed early");
  console.log("early: return", closed.done, closed.value);
  const after = await g.next();
  console.log("early: after", after.done, after.value);
}

// `.throw()` mid-stream: the body's catch sees it and may keep yielding.
async function* catching(): AsyncGenerator<string, void, undefined> {
  try {
    yield "a";
  } catch (e) {
    console.log("gen: caught", (e as Error).message);
    yield "b";
  }
  yield "c";
}

async function throwIn(): Promise<void> {
  const g = catching();
  console.log("throwIn:", (await g.next()).value);
  console.log("throwIn:", (await g.throw(new Error("boom"))).value);
  console.log("throwIn:", (await g.next()).value);
  const end = await g.next();
  console.log("throwIn: end", end.done, end.value);
}

// A body that REJECTS: the resume's promise rejects, and the generator is
// done afterwards.
async function* failing(): AsyncGenerator<number, void, undefined> {
  yield 1;
  throw new Error("body failed");
}

async function rejecting(): Promise<void> {
  const g = failing();
  console.log("rejecting: first", (await g.next()).value);
  try {
    await g.next();
    console.log("rejecting: NO THROW");
  } catch (e) {
    console.log("rejecting: caught", (e as Error).message);
  }
  const after = await g.next();
  console.log("rejecting: after", after.done, after.value);
}

async function main(): Promise<void> {
  await drainByHand();
  await earlyReturn();
  await throwIn();
  await rejecting();
}

void main();
