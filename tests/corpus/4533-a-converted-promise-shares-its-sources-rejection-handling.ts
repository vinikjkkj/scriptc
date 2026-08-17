// `const u: Promise<unknown> = a` is an ASSIGNMENT in JS: one object, one
// rejection, one place to handle it. Here the payload representations differ
// (`promise<f64>` vs `promise<dyn>`), so `promiseCoerceAdapter` mints an
// adapter promise and memoises it on the source so repeated conversions keep
// `===`. That adapter is a SECOND promise the unhandled-rejection ledger
// tracks, and handling the promise the program can NAME left the other one
// rejected with nobody attached — a spurious `Unhandled promise rejection` and
// exit 1 where Node exits 0.
//
// zapo `infra/perf/PromiseDedup.ts` is the site: `inFlight` is a
// `Map<string, Promise<unknown>>`, so filing the in-flight promise converts it.
// On the `requestHistorySync` failure path (`key bundle response list is
// empty`) the driver step CATCHES the error and prints it, and the compiled
// client then died at window open anyway, cutting a ~47 s run to ~35 s.
//
// THE THREE CASES, and only one of them was ever wrong. They are all here
// because the first two are what a one-way fix has to leave alone, and the
// first attempt at this fix broke case 1:
//
//   1 neither handled  -> the rejection IS unhandled. Node reports it and so
//                         must this runtime. ONE report, for the one promise
//                         the source program has.
//   2 only the ADAPTER handled -> handled.
//   3 only the SOURCE handled  -> handled. This was the broken one.
//
// Case 1 is observed through a `process.on('unhandledRejection')` listener
// rather than by dying, so all three can live in one fixture: a listener
// suppresses the default report and the exit, which is Node's own contract,
// and it makes the REPORT COUNT the thing being compared instead of an exit
// code the harness cannot see past.

const reports: string[] = [];
process.on("unhandledRejection", (reason: unknown) => {
  reports.push((reason as Error).message);
});

async function boom(tag: string): Promise<number> {
  throw new Error(tag);
}

function tick(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function drain(label: string): void {
  console.log(label, "reported:", reports.length === 0 ? "none" : reports.join(","));
  reports.length = 0;
}

async function neitherHandled(): Promise<void> {
  const a = Promise.resolve().then(() => boom("case1"));
  const u: Promise<unknown> = a;
  await tick(20);
  drain("1 neither:");
  console.log("   adapter exists:", u !== undefined);
}

async function onlyAdapterHandled(): Promise<void> {
  const a = Promise.resolve().then(() => boom("case2"));
  const u: Promise<unknown> = a;
  try {
    await u;
  } catch (e) {
    console.log("2 adapter caught:", (e as Error).message);
  }
  await tick(20);
  drain("2 adapter:");
  console.log("   source exists:", a !== undefined);
}

async function onlySourceHandled(): Promise<void> {
  const a = Promise.resolve().then(() => boom("case3"));
  const u: Promise<unknown> = a;
  try {
    await a;
  } catch (e) {
    console.log("3 source caught:", (e as Error).message);
  }
  await tick(20);
  drain("3 source:");
  console.log("   adapter exists:", u !== undefined);
}

// The zapo shape itself: a dedupe map that files the in-flight promise under a
// `Promise<unknown>` value type, with the `.then(...).finally(...)` chain
// `PromiseDedup.run` builds. Both callers await, both catch, and nothing is
// left over.
class Dedup {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  public run(key: string, task: () => Promise<number>): Promise<number> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<number>;
    const created = Promise.resolve()
      .then(() => task())
      .finally(() => {
        if (this.inFlight.get(key) === created) this.inFlight.delete(key);
      });
    this.inFlight.set(key, created);
    return created;
  }
}

async function dedupShape(): Promise<void> {
  const d = new Dedup();
  const first = d.run("k", () => boom("case4"));
  const second = d.run("k", () => boom("case4-never-runs"));
  try {
    await first;
  } catch (e) {
    console.log("4 first caught:", (e as Error).message);
  }
  try {
    await second;
  } catch (e) {
    console.log("4 second caught:", (e as Error).message);
  }
  await tick(20);
  drain("4 dedup:");
}

// A conversion written AFTER the source was already handled: the other order of
// the same fact, and the one `scr_prom_observe` cannot see because by then no
// further observation of the source is coming.
async function convertedAfterHandling(): Promise<void> {
  const a = Promise.resolve().then(() => boom("case5"));
  try {
    await a;
  } catch (e) {
    console.log("5 caught first:", (e as Error).message);
  }
  const u: Promise<unknown> = a;
  await tick(20);
  drain("5 late conversion:");
  console.log("   adapter exists:", u !== undefined);
}

// Controls: the combinator shapes that were ALREADY right and must not move.
async function controls(): Promise<void> {
  try {
    await Promise.all([boom("c1a"), boom("c1b"), boom("c1c")]);
  } catch (e) {
    console.log("C1 all:", (e as Error).message);
  }
  const chained = boom("c2").finally(() => {
    console.log("C2 finally ran");
  });
  try {
    await chained;
  } catch (e) {
    console.log("C2 chain:", (e as Error).message);
  }
  await tick(20);
  drain("C controls:");
}

async function main(): Promise<void> {
  await neitherHandled();
  await onlyAdapterHandled();
  await onlySourceHandled();
  await dedupShape();
  await convertedAfterHandling();
  await controls();
  console.log("done");
}

void main();
