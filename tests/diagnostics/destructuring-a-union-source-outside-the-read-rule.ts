/* The union-source destructurings the read rule deliberately does NOT
 * claim, pinned from outside so the boundary is tested by what it refuses.
 *
 * The rule it does claim: an OBJECT pattern over a union source binds each
 * name from the SAME property read a union receiver already answers -- the
 * same-typed arm read, the lifted per-arm join, the index-signature keyed
 * read (corpus 7790). The desugar is the reads, so the two spellings cannot
 * disagree.
 *
 * A REST element is the deliberate hole, and it is a real one. `{ a,
 * ...rest }` binds the fields the pattern did NOT consume, and over a union
 * that set is decided by the TAG at runtime: no single record shape spells
 * it, and the checker's rest type is itself a union the packing loop has no
 * form for. The whole pattern drops through to the source-kind fence, so
 * the message names the source rather than the element -- which is the
 * honest blame here, because narrowing the source is the fix for the whole
 * pattern and not for one name of it.
 *
 * An ARRAY pattern over a union source is refused by the same source-kind
 * rule one branch over. It is not the object pattern's question in
 * disguise: the positions of a union of tuples are a per-arm story with its
 * own iteration order, and the tuple reader below wants one shape.
 *
 * A NAME NO ARM ANSWERS is the third: the reader declines for exactly the
 * reason the `.name` read on the same value declines, and the element's own
 * diagnostic says so and points at the same fix. */

type Blocklist =
  | { readonly lidJid: string; readonly pnJid: string | null }
  | { readonly lidJid: null; readonly pnJid: string; readonly legacy: boolean };

// A REST element: the unconsumed field set is a runtime fact here.
function withRest(target: Blocklist): string {
  const { pnJid, ...rest } = target;
  return String(pnJid) + JSON.stringify(rest);
}

// An ARRAY pattern over a union of tuples.
function positions(pair: readonly [number, string] | readonly [string, number]): string {
  const [first, second] = pair;
  return String(first) + "/" + String(second);
}

// A name only ONE arm declares -- the same read `target.legacy` refuses.
function onlyOneArm(target: Blocklist): string {
  const { legacy } = target as Blocklist & { readonly legacy?: boolean };
  return String(legacy);
}

console.log(withRest({ lidJid: "a", pnJid: null }));
console.log(positions([1, "x"]));
console.log(onlyOneArm({ lidJid: null, pnJid: "p", legacy: true }));
