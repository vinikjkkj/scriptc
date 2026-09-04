// `PromiseLike<T>` lowers to the SAME slot as `Promise<T>`. In TypeScript
// PromiseLike is *any thenable*, so that answer is only true because every
// value that can reach such a slot in a compiled program is a real promise:
// an object literal, a class instance or a function carrying a `then` maps
// to a record/class/func, none of which is the promise type, so the
// assignment that would put one here is refused where it is written
// (tests/diagnostics/promiselike-hand-rolled-thenable.ts pins those).
//
// What this program pins is the admitted half, and it pins the parts a
// wrong lowering would get wrong SILENTLY rather than loudly:
//   - the bare slot, awaited in value and in statement position;
//   - `T | PromiseLike<T>` — the settle-or-value union, which is the shape
//     the await-unwrapping idiom actually spells and which zapo's sqlite
//     store uses to reject an async transaction callback;
//   - HOW MANY microtask hops each arm costs, measured against a `.then`
//     chain used as a ruler. A representation that awaited the non-promise
//     arm with a different number of hops would print the same values in a
//     different interleaving, and nothing else in the program would say so.
//   - a rejected promise in the slot, which must re-throw at the await;
//   - a `then`-shaped runtime guard over the union, which must answer TRUE
//     for the promise arm (the dyn read of `then` on a promise handle —
//     7471 pins that read on its own).

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

const order: string[] = [];

function ruler(n: number): void {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) {
    const k = i;
    p = p.then(() => {
      order.push(`t${String(k)}`);
    });
  }
}

async function plainArm(): Promise<void> {
  const v: number | PromiseLike<number> = 1;
  order.push(`A=${String(await v)}`);
}

async function promiseArm(): Promise<void> {
  const v: number | PromiseLike<number> = Promise.resolve(2);
  order.push(`B=${String(await v)}`);
}

async function bareSlot(): Promise<void> {
  const v: PromiseLike<number> = Promise.resolve(3);
  order.push(`C=${String(await v)}`);
}

function make(which: number): number | PromiseLike<number> {
  return which === 0 ? 7 : Promise.resolve(8);
}

async function main(): Promise<void> {
  // Value position, statement position, and the same promise awaited twice
  // (a promise settles once, so both awaits see the same value).
  const p: PromiseLike<number> = Promise.resolve(1);
  await p;
  const v: number = await p;
  console.log("value", v, await p);

  const q: PromiseLike<void> = Promise.resolve();
  await q;
  console.log("void slot awaited");

  // Rejection rides the same slot and re-throws at the await.
  const bad: PromiseLike<number> = Promise.reject(new Error("boom"));
  try {
    console.log("unreachable", await bad);
  } catch (e) {
    console.log("caught", e instanceof Error ? e.message : "?");
  }

  // The then-shaped guard over the settle-or-value union: false for the
  // value arm, true for the promise arm. zapo's sqlite store throws on the
  // true answer, so a runtime that always said false would COMMIT a
  // transaction it was written to reject.
  const a = make(0);
  const b = make(1);
  console.log("guard", isPromiseLike<number>(a), isPromiseLike<number>(b));
  console.log("awaited", await a, await b);

  // The interleaving. Both awaits below run against the same ruler.
  ruler(12);
  void plainArm();
  void promiseArm();
  void bareSlot();
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
  console.log(order.join(" "));
}

void main();
