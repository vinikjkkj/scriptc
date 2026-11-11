// JS throws any value. null and undefined used to stop the compiler (SC9001, "bare unitLit outside a unionWrap"); every case below must
// print what Node prints: sync and async throws, the catch binding read four ways, rethrow, finally, and a rejected async result.
function throwNull(): void { throw null; }
function throwUndefined(): void { throw undefined; }
function throwVoid0(): void { throw void 0; }
function throwZero(): void { throw 0; }
function throwEmpty(): void { throw ""; }
function throwNaN(): void { throw NaN; }
async function asyncNull(): Promise<void> { throw null; }
async function asyncUndefined(): Promise<number> { throw undefined; }
async function asyncZero(): Promise<string> { throw 0; }
async function asyncVoidUndefined(): Promise<void> { throw undefined; }
async function asyncVoidZero(): Promise<void> { throw 0; }

function show(tag: string, run: () => void): void {
  try {
    run();
    console.log(tag, "no throw");
  } catch (e) {
    console.log(tag, String(e), `${e}`, typeof e, e === null, e === undefined, e == null, !e);
  }
}
show("sync null", throwNull);
show("sync undefined", throwUndefined);
show("sync void 0", throwVoid0);
show("sync zero", throwZero);
show("sync empty", throwEmpty);
show("sync NaN", throwNaN);

// The binding flows on: logged, rethrown, passed through a function taking unknown.
function describe(v: unknown): string { return v === null ? "null!" : v === undefined ? "undefined!" : "other:" + String(v); }
try { throwNull(); } catch (e) { console.log("logged", e); console.log("described", describe(e)); }
try { throwUndefined(); } catch (e) { console.log("logged", e); console.log("described", describe(e)); }
try {
  try { throwNull(); } catch (e) { console.log("inner", String(e)); throw e; }
} catch (e2) {
  console.log("outer", String(e2), e2 === null);
}
try {
  try { throwUndefined(); } finally { console.log("finally runs"); }
} catch (e) {
  console.log("after finally", String(e), e === undefined);
}

async function attempt(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.log(name, "await", String(e), typeof e, e === null, e === undefined);
  }
}

async function main(): Promise<void> {
  await attempt("asyncNull", asyncNull);
  await attempt("asyncUndefined", asyncUndefined);
  await attempt("asyncZero", asyncZero);
  await asyncNull().catch((e) => console.log("catch cb null", String(e), typeof e, e === null));
  await asyncUndefined().catch((e) => console.log("catch cb undefined", String(e), typeof e, e === undefined));
  const voids: Promise<void>[] = [asyncNull(), asyncVoidUndefined(), asyncVoidZero()];
  const settled = await Promise.allSettled(voids);
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]!;
    if (r.status === "rejected") console.log("settled", i, String(r.reason), typeof r.reason);
  }
  await asyncNull().then(() => console.log("not here"), (e) => console.log("then cb", String(e)));
}
main().then(() => console.log("done"));
