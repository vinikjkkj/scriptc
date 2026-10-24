// `Promise.all(ps)` over a `Promise<void>[]` whose combined result is HELD
// rather than awaited for its effect -- zapo's history-sync shape:
//
//   const settled = Promise.all(pendingWrites)
//   ...
//   await settled
//
// `await Promise.all(voids)` standing as a statement reads nothing, and the
// lowering answers it with a `Promise<void>`: no array is built. Bound to a
// name that collapse cannot stand, because the checker types the call
// `Promise<void[]>` and Node really does fulfil it with an array of
// `undefined`s -- one per entry, in entry order.
//
// Both spellings are here on purpose: the discarded await must keep behaving
// exactly as it always has, and the held value must read like Node's.

const order: string[] = [];
  // Timer spacing: Node orders timers by deadline (start + delay), and the
  // start is the live clock at registration, so a registration gap larger
  // than the delay gap reorders them. The 2-12 ms gaps this used to have
  // flipped under sanitized LLVM load (CI: "expected b>c>a, got b>a>c" in 8
  // jobs, 2026-10-21..24). Node itself promises no order across timers armed
  // at different moments; 20 ms steps keep the printed order what Node
  // prints on any host that registers three timers within 20 ms.

function nap(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function write(tag: string, ms: number): Promise<void> {
  await nap(ms);
  order.push(tag);
}

async function boom(tag: string, ms: number): Promise<void> {
  await nap(ms);
  order.push(tag);
  throw new Error("write-" + tag + "-failed");
}

async function main(): Promise<void> {
  // (1) Held, then awaited: the payload is an array of undefineds, one per
  // entry. The slowest entry is FIRST, so the array is not settle order.
  const pendingWrites: Promise<void>[] = [write("a", 60), write("b", 20), write("c", 40)];
  const settled = Promise.all(pendingWrites);
  const results = await settled;
  console.log("1:", results.length, order.join(">"));
  console.log("  first:", results[0]);
  console.log("  last:", results[results.length - 1]);

  // (2) The held promise awaited TWICE yields the same array both times.
  const again = await settled;
  console.log("2:", again.length, again[0], results.length === again.length);

  // (3) An EMPTY array of writes: an empty result, no work.
  const none: Promise<void>[] = [];
  const emptyHeld = Promise.all(none);
  const empty = await emptyHeld;
  console.log("3:", empty.length, Array.isArray(empty));

  // (4) A held array LITERAL still needs a CONTEXT that types it as an
  // array. `const one = Promise.all([write("d", 2)])` binds at the
  // checker tuple `Promise<[void]>`, which the array result does not fit,
  // and it keeps its fence; passed where a `Promise<void[]>` is wanted --
  // case (7) below -- tsc types the literal as the array and it compiles.

  // (5) The DISCARDED await -- the shape that has always compiled. The
  // writes still happen and nothing reads a payload.
  order.length = 0;
  const more: Promise<void>[] = [write("e", 30), write("f", 10)];
  await Promise.all(more);
  console.log("5:", order.join(">"));

  // (6) A rejection reaches the HELD promise, and it is the first one in
  // TIME, not in position.
  const risky: Promise<void>[] = [boom("slow", 50), boom("fast", 20)];
  const held = Promise.all(risky);
  try {
    await held;
    console.log("6: no throw");
  } catch (e) {
    console.log("6:", e instanceof Error ? e.message : "non-error");
  }
  // The `order` line at the end used to RACE: `slow` is a 10 ms timer armed
  // here, while step 7's chain below is nominally ~6 ms, so whether `slow`
  // lands before the print depended on how late the runtime's timers were.
  // It was not stable even in node -- ten runs of this shape on one host
  // gave `fast>slow>g>h` five times, `fast>g>h` (slow MISSING) four times
  // and `fast>g>slow>h` once. Awaiting it here makes the ordering CAUSAL
  // instead of temporal, so the expected output is the same string on any
  // timer granularity. Step 6's own assertion is untouched: the catch above
  // has already run, and this only settles when `slow` finally pushes.
  await risky[0]!.catch(() => {});

  // (7) The held value passed to a helper at its own type, and indexed
  // there.
  const readAll = async (p: Promise<void[]>): Promise<string> => {
    const xs = await p;
    return xs.length + ":ok";
  };
  console.log("7:", await readAll(Promise.all([write("g", 20), write("h", 40)])));

  console.log("order:", order.join(">"));
}

void main();
