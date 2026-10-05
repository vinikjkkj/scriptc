// The microtask-turn ruler behind tests/harness/microtask-turns.test.ts.
//
// Every line is "<turns>  <construct>": how many microtask turns elapse
// between the subject starting and its continuation running. The numbers are
// MEASURED against Node v25.9.0, not read off the spec, and the same program
// runs under Node in the test so the pins cannot drift away from the oracle
// while still agreeing with themselves.
//
// TWO CLOCKS, and the reason is that a clock built out of the construct under
// test cannot see that construct move.
//
//   Clock A (rows 1-15) is a loop of `await null`. That rides
//   scr_await_hop -> scr_await_yield, which is NOT the settled-await path, so
//   a change to what an already-settled `await` costs moves the SUBJECT rows
//   without moving the clock. It reads true turn counts.
//
//   Clock B (rows 16-18) is the self-chaining `Promise.resolve().then` of
//   tests/fixtures/for-await-turns/turns.ts. In this runtime `.then` lowers to
//   a lifted async function, so clock B DOES ride the settled-await path. It
//   re-measures three constructs clock A already covered: when the two clocks
//   disagree about the same construct, the settled-await cost itself moved.
//
// Phases are separated by a timer so each subject starts on a drained queue
// with a fresh clock.
let tickA = 0;
let mark = -1;

async function clockA(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await null;
    tickA = tickA + 1;
  }
}

let tickB = 0;
let era = 0;

function tickB_(k: number): void {
  if (k === era && tickB < 24) {
    tickB = tickB + 1;
    void Promise.resolve().then(() => {
      tickB_(k);
    });
  }
}

function clockB(): void {
  era = era + 1;
  tickB = 0;
  const k = era;
  void Promise.resolve().then(() => {
    tickB_(k);
  });
}

function settledNum(): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(7);
  });
}

async function plainAsync(): Promise<number> {
  return 7;
}

// `return p` — the async return-adoption path (lowerer.ts asyncReturnFlatten).
async function returnAdopt(): Promise<number> {
  return settledNum();
}

// `return await p` — the explicit form the one above lowers to.
async function awaitInside(): Promise<number> {
  const v = await settledNum();
  return v;
}

async function nestedTwo(): Promise<number> {
  const v = await plainAsync();
  return v;
}

async function* gen1(): AsyncGenerator<number, void, undefined> {
  yield 1;
}
async function* gen2(): AsyncGenerator<number, void, undefined> {
  yield 1;
  yield 2;
}
async function* gen3(): AsyncGenerator<number, void, undefined> {
  yield 1;
  yield 2;
  yield 3;
}

let sink = 0;

// ── clock A subjects ──────────────────────────────────────────────────
async function a1(): Promise<void> {
  await null;
  mark = tickA;
}
async function a2(): Promise<void> {
  await settledNum();
  mark = tickA;
}
async function a3(): Promise<void> {
  await plainAsync();
  mark = tickA;
}
async function a4(): Promise<void> {
  await returnAdopt();
  mark = tickA;
}
async function a5(): Promise<void> {
  await awaitInside();
  mark = tickA;
}
async function a6(): Promise<void> {
  await nestedTwo();
  mark = tickA;
}
async function a7(): Promise<void> {
  await settledNum().then((v: number) => {
    return v + 1;
  });
  mark = tickA;
}
async function a8(): Promise<void> {
  await Promise.resolve(3);
  mark = tickA;
}
async function a9(): Promise<void> {
  await Promise.all([settledNum(), settledNum()]);
  mark = tickA;
}
async function a10(): Promise<void> {
  for await (const x of gen1()) {
    sink = sink + x;
  }
  mark = tickA;
}
async function a11(): Promise<void> {
  for await (const x of gen2()) {
    sink = sink + x;
  }
  mark = tickA;
}
async function a12(): Promise<void> {
  for await (const x of gen3()) {
    sink = sink + x;
  }
  mark = tickA;
}
async function a13(): Promise<void> {
  await Promise.race([settledNum(), settledNum()]);
  mark = tickA;
}
async function a14(): Promise<void> {
  const r = Promise.withResolvers<number>();
  queueMicrotask(() => {
    r.resolve(5);
  });
  await r.promise;
  mark = tickA;
}
async function a15(): Promise<void> {
  const r = Promise.withResolvers<number>();
  process.nextTick(() => {
    r.resolve(5);
  });
  await r.promise;
  mark = tickA;
}

// ── clock B subjects (the clock's own cross-check) ────────────────────
async function b16(): Promise<void> {
  await null;
  mark = tickB;
}
async function b17(): Promise<void> {
  await settledNum();
  mark = tickB;
}
async function b18(): Promise<void> {
  await plainAsync();
  mark = tickB;
}

const labels: string[] = [
  "await null",
  "await new Promise(r => r(v))",
  "await asyncWithNoAwait()",
  "await (async () => { return p })()",
  "await (async () => { return await p })()",
  "await (async () => { return await asyncWithNoAwait() })()",
  "await p.then(f)",
  "await Promise.resolve(v)",
  "await Promise.all([settled, settled])",
  "for await over a 1-yield async generator",
  "for await over a 2-yield async generator",
  "for await over a 3-yield async generator",
  "await Promise.race([settled, settled])",
  "await a pending promise resolved by queueMicrotask",
  "await a pending promise resolved by process.nextTick",
  "clockB: await null",
  "clockB: await new Promise(r => r(v))",
  "clockB: await asyncWithNoAwait()",
];

function subject(n: number): void {
  if (n === 1) {
    void a1();
  } else if (n === 2) {
    void a2();
  } else if (n === 3) {
    void a3();
  } else if (n === 4) {
    void a4();
  } else if (n === 5) {
    void a5();
  } else if (n === 6) {
    void a6();
  } else if (n === 7) {
    void a7();
  } else if (n === 8) {
    void a8();
  } else if (n === 9) {
    void a9();
  } else if (n === 10) {
    void a10();
  } else if (n === 11) {
    void a11();
  } else if (n === 12) {
    void a12();
  } else if (n === 13) {
    void a13();
  } else if (n === 14) {
    void a14();
  } else if (n === 15) {
    void a15();
  } else if (n === 16) {
    void b16();
  } else if (n === 17) {
    void b17();
  } else {
    void b18();
  }
}

function phase(n: number): void {
  mark = -1;
  // The clock starts FIRST, so in every round its continuation is queued
  // ahead of the subject's and `mark` is the number of clock turns that
  // completed before the subject resumed.
  if (n <= 15) {
    tickA = 0;
    void clockA();
  } else {
    clockB();
  }
  subject(n);
  setTimeout(() => {
    console.log(`${mark}  ${labels[n - 1]}`);
    if (n < 18) {
      phase(n + 1);
    }
  }, 20);
}

phase(1);
