// `new Array(n)` with NO type argument and no annotation, filled by the very
// next counting loop.
//
// tsc types it `any[]`: `new Array(n)` is not one of the initializers TS's
// evolving-array analysis follows, so there is no element type to map. The
// site produced THREE diagnostics in one host function —
//   SC2011 values of type 'any[]' have no static representation …
//   SC1090 assignment to non-array elements are not supported yet
//   SC2004 uses of '<binding>' inherit the blocker on its declaration
// — which is zapo's `signal/group/SenderKeyManager.ts:185/187/194`, the one
// place in that census where three rows are one unit of work.
//
// The counting-loop proof (fullFillLoopWrites) already existed, for the
// absent-slot question: it establishes that the very next statement is a
// counting loop over the SAME length expression, that every path finishing an
// iteration writes `a[i]` first, and that nothing else in the body touches
// `a`. So the writes ARE the array's contents, exhaustively — their common
// type is the element type, and that is an observation, not a guess.
//
// Nothing is widened. Every write must map and they must all map to the SAME
// IR type; two writes of different shapes name no single element type and the
// site keeps its `any[]` refusal. The four DECLINE controls at the bottom of
// this file are compile-time-clean on both sides precisely because they do
// not go through the new path at all — they are exercised as fences by the
// diagnostics lane, not here; what this file proves is the positive side plus
// that the proof's own gates still gate (`sparse` keeps `any[]` and so is not
// written here at all).

type Addr = { readonly user: string; readonly device: number };
type Dist = {
  readonly groupId: string;
  readonly sender: Addr;
  readonly keyId: number;
  readonly timestampMs: number;
};

function upsert(rows: readonly Dist[]): string {
  return rows.map((r) => `${r.groupId}/${r.sender.user}:${r.sender.device}/${r.keyId}@${r.timestampMs}`).join("|");
}

// zapo's exact shape, down to the downstream `readonly T[]` parameter.
function markDistributed(groupId: string, keyId: number, participants: readonly Addr[]): string {
  const timestampMs = 1700;
  const distributions = new Array(participants.length);
  for (let index = 0; index < participants.length; index += 1) {
    distributions[index] = {
      groupId,
      sender: participants[index],
      keyId,
      timestampMs,
    };
  }
  return upsert(distributions);
}

console.log(markDistributed("g1", 7, [{ user: "a", device: 0 }, { user: "b", device: 1 }]));
console.log(markDistributed("g2", 1, [{ user: "solo", device: 5 }]));
console.log(markDistributed("g3", 0, []));

// The postfix `i++` incrementor spelling, and a length that is a plain local.
function squares(n: number): string {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { i, sq: i * i };
  }
  return out.map((r) => `${r.i}^2=${r.sq}`).join(",");
}
console.log(squares(4));
console.log(squares(0));

// The GUARDED fill the proof was written for: three writes on three paths,
// every one before its `continue`, and all of the same shape.
type Slot = { readonly key: string; readonly hit: boolean };
function classify(keys: readonly string[]): string {
  const rows = new Array(keys.length);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i]!;
    if (k.length === 0) {
      rows[i] = { key: "<empty>", hit: false };
      continue;
    }
    if (k.startsWith("_")) {
      rows[i] = { key: k.slice(1), hit: false };
      continue;
    }
    rows[i] = { key: k, hit: true };
  }
  return rows.map((r) => `${r.key}:${r.hit}`).join(" ");
}
console.log(classify(["a", "", "_b", "c"]));

// The element read back after the loop, and the array's own length.
function firstUser(participants: readonly Addr[]): string {
  const rows = new Array(participants.length);
  for (let i = 0; i < participants.length; i += 1) {
    rows[i] = { groupId: "g", sender: participants[i]!, keyId: i, timestampMs: 0 };
  }
  if (rows.length === 0) return "-";
  const head: Dist = rows[0]!;
  return `${head.sender.user}#${rows.length}`;
}
console.log(firstUser([{ user: "x", device: 2 }, { user: "y", device: 3 }]));
console.log(firstUser([]));

// An ANNOTATED `new Array<T>(n)` next to the inferred one: the annotation
// still wins and nothing about it moved.
function annotated(n: number): number {
  const xs = new Array<{ readonly v: number }>(n);
  for (let i = 0; i < n; i += 1) {
    xs[i] = { v: i * 2 };
  }
  return xs.reduce((a, r) => a + r.v, 0);
}
console.log(annotated(5));
