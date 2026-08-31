// `.catch(h)` where h is a handler VALUE, not an inline function literal.
//
// The inline form exists because the handler's PARAMETER becomes the
// typed-catch binding. A value has no parameter to bind, so it takes the
// caught value as an ordinary ARGUMENT. Every shape below is one the
// inline form cannot spell: a named declaration, an imported function, a
// binding that came from an enclosing Promise executor (zapo's
// `Promise.all(peerSendChains).catch(reject)`), and one that rethrows.
//
// Each case also pins what must NOT change: a promise that FULFILS never
// calls its handler and passes its value through, and a handler that
// throws rejects the combined promise rather than swallowing.
import { imported, rethrow } from "./handlers.ts";

function named(e: unknown): void {
  console.log("named:", e instanceof Error ? e.message : "?");
}
const stored = (e: unknown): void => {
  console.log("stored:", e instanceof Error ? e.message : "?");
};
function thrower(e: unknown): void {
  console.log("thrower saw:", e instanceof Error ? e.message : "?");
  throw new Error("from-handler");
}

async function bad(tag: string): Promise<void> {
  throw new Error(tag);
}
async function good(): Promise<void> {}
async function num(n: number): Promise<number> {
  return n;
}
async function badNum(tag: string): Promise<number> {
  throw new Error(tag);
}

async function main(): Promise<void> {
  // 1. A named function declaration.
  await bad("a").catch(named);

  // 2. An imported one.
  await bad("b").catch(imported);

  // 3. A const-bound arrow -- a VALUE, though its text is a literal.
  await bad("c").catch(stored);

  // 4. The promise FULFILS: the handler never runs.
  await good().catch(named);
  console.log("4: handler did not run");

  // 5. The handler THROWS: the combined promise rejects with its error.
  try {
    await bad("d").catch(thrower);
    console.log("5: no throw");
  } catch (e) {
    console.log("5:", e instanceof Error ? e.message : "?");
  }

  // 6. A RETHROWING handler (its return type is `never`): the original
  //    error reaches the awaiter.
  try {
    await bad("e").catch(rethrow);
    console.log("6: no throw");
  } catch (e) {
    console.log("6:", e instanceof Error ? e.message : "?");
  }

  // 7. The zapo shape: `reject` from an enclosing Promise executor, over a
  //    Promise.all whose combined result is a union of the array arm and
  //    the handler's undefined. The rejection reaches the outer promise.
  const chains: Promise<void>[] = [good(), bad("f")];
  const done = new Promise<void>((resolve, reject) => {
    Promise.all(chains).catch(reject);
    setTimeout(() => resolve(), 50);
  });
  try {
    await done;
    console.log("7: resolved");
  } catch (e) {
    console.log("7:", e instanceof Error ? e.message : "?");
  }

  // 8. The same, but nothing rejects: the timeout resolves it.
  const okChains: Promise<void>[] = [good(), good()];
  const done2 = new Promise<void>((resolve, reject) => {
    Promise.all(okChains).catch(reject);
    setTimeout(() => resolve(), 1);
  });
  await done2;
  console.log("8: resolved");

  // 9. A non-void payload passes THROUGH an untaken handler.
  const v = await num(41).catch(named);
  console.log("9:", v);

  // 10. Handler ordering against a plain microtask: `.catch` schedules on
  //     the rejection, so the already-queued microtask goes first.
  const seq: string[] = [];
  const p = badNum("g").catch((e) => {
    seq.push("catch");
    return -1;
  });
  await Promise.resolve().then(() => {
    seq.push("micro");
  });
  const got = await p;
  console.log("10:", seq.join(","), got);
}

void main();
