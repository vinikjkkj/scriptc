// A Set of promises -- the pending-task registry.
//
// Set elements key by reference identity, which promises satisfy like any
// other heap value. What kept them out was the cycle: the idiom is
// `set.add(p)` followed by `p.finally(() => set.delete(p))`, and that
// closure captures BOTH, so the pair points at itself through the set's
// ELEMENT. A Set keeps elements on the key side, and the collector's trace
// visited values only, so the cycle was invisible and the pair leaked.
//
// The runtime side of that is scr_set_new_ref_traced: a set whose elements
// can point back is headered and its trace visits the keys (its teardown
// stops releasing them in the same breath, or they would be freed twice).
const pending = new Set<Promise<void>>();
const order: string[] = [];

function launch(name: string, ms: number): void {
  const p = (async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
    order.push(name);
  })();
  pending.add(p);
  void p.finally(() => {
    pending.delete(p);
  });
}

async function main(): Promise<void> {
  launch("a", 1);
  launch("b", 2);
  launch("c", 3);
  console.log(pending.size);

  await new Promise<void>((r) => setTimeout(r, 40));
  console.log(pending.size, order.join(","));

  // A second round, to show the set is reusable after draining.
  launch("d", 1);
  console.log(pending.size);
  await new Promise<void>((r) => setTimeout(r, 40));
  console.log(pending.size, order.join(","));

  // has/delete over element identity.
  const solo = (async () => {})();
  pending.add(solo);
  console.log(pending.has(solo), pending.size);
  console.log(pending.delete(solo), pending.has(solo), pending.size);
  await solo;
}

void main();
