// A union's per-arm literal table lives on the IR union def, and a def is
// shared by every ts union whose ARMS map to the same IR types. String
// literals erase to `string`, so a discriminated union and an undiscriminated
// one can be the SAME def:
//
//     { kk: 'n'; p: string } | { kk: 'w'; p: string; q: string }
//     { kk: string; p: string } | { kk: string; p: string; q: string }
//
// Both are `{ kk: string; p: string } | { kk: string; p: string; q: string }`
// in the IR. The second one's values may hold ANY string in `kk`, and they
// reach the same arm chain — so the constraint cannot be applied to them, and
// the two cannot each have their own answer.
//
// The registry therefore treats "my arms are told apart by nothing" as a
// VERDICT rather than as silence: the first site to say it erases the table
// and remembers, so no later site can put one back. The cost is that a
// program containing both spellings loses the discriminant for both; the
// alternative is reading one union's values against literals they never had,
// which can prefer a narrower arm over the wider one the value actually is.
//
// What must hold, and is what this file pins: the UNDISCRIMINATED union keeps
// working exactly as it did — widest arm first, every field readable — and the
// discriminated one still answers wherever structure alone decides. (The
// disagreement case, where a value carries the wider arm's fields and pins the
// narrower arm's literal, is deliberately NOT written here: with the table
// erased it has the pre-discriminant answer, and corpus 4951 is where it is
// pinned in a program that does not collide.)

type PlainNarrow = { readonly kk: string; readonly p: string };
type PlainWide = { readonly kk: string; readonly p: string; readonly q: string };
type Plain = PlainNarrow | PlainWide;

type PinnedNarrow = { readonly kk: 'n'; readonly p: string };
type PinnedWide = { readonly kk: 'w'; readonly p: string; readonly q: string };
type Pinned = PinnedNarrow | PinnedWide;

function bag(kk: string, p: string, q: string | null): unknown {
  const o: Record<string, unknown> = {};
  o['kk'] = kk;
  o['p'] = p;
  if (q !== null) o['q'] = q;
  return o;
}

function renderPlain(v: Plain): string {
  return 'q' in v ? 'plain-wide kk=' + v.kk + ' p=' + v.p + ' q=' + v.q : 'plain-narrow kk=' + v.kk + ' p=' + v.p;
}
function renderPinned(v: Pinned): string {
  if (v.kk === 'w') return 'pinned-wide p=' + v.p + ' q=' + v.q;
  return 'pinned-narrow p=' + v.p;
}

// The undiscriminated union: the widest arm that fits wins, and the wide
// arm's own field is readable — the shadowing fix, unchanged by any of this.
console.log(renderPlain(bag('n', 'P1', 'Q1') as Plain));
console.log(renderPlain(bag('x', 'P2', null) as Plain));
console.log(renderPlain(bag('w', 'P3', 'Q3') as Plain));

// The discriminated one, wherever structure alone decides.
console.log(renderPinned(bag('w', 'P4', 'Q4') as Pinned));
console.log(renderPinned(bag('n', 'P5', null) as Pinned));
