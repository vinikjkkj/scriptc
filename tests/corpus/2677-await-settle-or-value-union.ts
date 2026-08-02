// The SETTLE-OR-VALUE contract, `T | Promise<T>`: a callback slot accepting
// the value or a promise of it. No `typeof`/`instanceof` test splits two
// object-flavored arms, so `await` is the only consumer such a union has --
// and it needs no test, because the union's own tag picks the branch.
type Rec = { readonly id: number };

async function collect(make: (k: number) => Rec | Promise<Rec>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await make(i);
    out.push(r.id);
  }
  return out;
}

// Rejection through the promise arm rethrows at the await, like any await.
async function boom(k: number): Promise<Rec> {
  if (k === 1) throw new Error("k1");
  return { id: k };
}

async function main(): Promise<void> {
  // The data arm: JS awaits a non-thenable through exactly one microtask
  // turn and yields it.
  console.log((await collect((k) => ({ id: k }))).join(","));
  // The promise arm: parks like any await.
  console.log((await collect(async (k) => ({ id: k * 10 }))).join(","));
  // Mixed, arm chosen per call.
  console.log((await collect((k) => (k % 2 === 0 ? { id: k } : Promise.resolve({ id: -k })))).join(","));

  try {
    await collect(boom);
    console.log("no throw");
  } catch (e) {
    console.log("caught", e instanceof Error ? e.message : "?");
  }

  // Interleaving: the data arm still yields to the microtask queue, so the
  // ticks scheduled before it run first. A missing hop reorders this line.
  const order: string[] = [];
  const p = Promise.resolve().then(() => {
    order.push("tick");
  });
  const v = await collect(() => ({ id: 0 }));
  order.push(`awaited${v.length}`);
  await p;
  console.log(order.join(">"));
}

void main();
