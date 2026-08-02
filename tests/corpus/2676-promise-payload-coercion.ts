// A promise whose PAYLOAD converts entering a wider promise slot. The payload
// slot is typed per kind, so there is no reinterpret that makes one stand in
// for the other -- the value goes through an async helper that awaits and
// coerces what comes out.
type A = { readonly kind: "a"; readonly a: number };
type B = { readonly kind: "b"; readonly b: string };

const mk: () => Promise<A> = async () => ({ kind: "a", a: 1 });

// Payload widening: Promise<A> into a Promise<A | B> slot.
const wide: () => Promise<A | B> = mk;

// Rejection rides through untouched: the helper awaits, so a rejected source
// rethrows inside it and rejects the adapted promise with the same value.
const shouldFail = true;
const boom: () => Promise<A> = async () => {
  if (shouldFail) throw new Error("boom");
  return { kind: "a", a: 2 };
};
const wideBoom: () => Promise<A | B> = boom;

async function main(): Promise<void> {
  const w = await wide();
  console.log(w.kind === "a" ? w.a : w.b);

  // Adapted twice through different slots: the helper interns per type pair.
  const again: () => Promise<A | B> = mk;
  const g = await again();
  console.log(g.kind === "a" ? g.a + 100 : g.b);

  try {
    await wideBoom();
    console.log("no throw");
  } catch (e) {
    console.log("caught", e instanceof Error ? e.message : "?");
  }
}

void main();
