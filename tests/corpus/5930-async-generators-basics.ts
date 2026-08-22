// `async function*` end to end through `for await`: the body starts
// SYNCHRONOUSLY inside the first resume (Node runs it up to the first
// yield before the consumer's await parks), suspends at each yield, may
// `await` between yields, and completes with the loop's exit.
//
// The ordering assertions here are the point of the program, not decoration:
// an async generator that yielded the right values in the wrong turns would
// still print the right numbers under a loop that only logged them, so every
// section interleaves generator output with consumer output.
async function* counter(): AsyncGenerator<number, void, void> {
  console.log("gen: start");
  yield 1;
  console.log("gen: after 1");
  yield 2;
  console.log("gen: after 2");
}

async function doubled(n: number): Promise<number> {
  return n * 2;
}

// An `await` INSIDE the body: the generator parks on the promise, so the
// consumer's own await stays pending across a real event-loop turn.
async function* awaiting(): AsyncGenerator<number, void, void> {
  for (const n of [1, 2, 3]) {
    const v = await doubled(n);
    yield v;
  }
}

// Parameters are packed at construction and read when the body first runs.
async function* fromList(items: readonly string[], tag: string): AsyncGenerator<string, void, void> {
  for (const it of items) {
    yield tag + ":" + it;
  }
}

// An immediately-exhausted generator: the loop body never runs. Declared at
// module scope because a NESTED `async function*` keeps its SC1071 refusal —
// only declaration-scope async generators lower.
async function* empty(): AsyncGenerator<number, void, void> {
  if (false) yield 1;
  console.log("gen: empty body ran");
}

async function main(): Promise<void> {
  console.log("main: created");
  for await (const v of counter()) console.log("main: got", v);
  console.log("main: counter drained");

  for await (const v of awaiting()) console.log("main: awaited", v);
  console.log("main: awaiting drained");

  for await (const s of fromList(["a", "b"], "t")) console.log("main:", s);

  // A generator bound to a local, then consumed — the value is an ordinary
  // refcounted handle.
  const g = counter();
  for await (const v of g) console.log("main: local", v);

  let seen = 0;
  for await (const v of empty()) {
    seen += v;
  }
  console.log("main: empty seen", seen);
}

main().then(() => console.log("main: done"));
console.log("sync: after main()");
