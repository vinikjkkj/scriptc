// `"k" in u` where the union the LOWERER sees still carries a unit arm the
// CHECKER narrowed away. tsc rejects `"k" in undefined` outright, so the
// arm is unreachable in a type-checked program — but the answer does not
// depend on believing that: the unit arm gets Node's own TypeError, and a
// LYING type predicate that lets the arm through really does throw it.

interface Bytes {
  readonly bytes: number;
  readonly width?: number;
}
interface Streamed {
  readonly contentLength: number;
  readonly width?: number;
}
type Thumb = Bytes | Streamed;

// The narrow that makes the operand legal is an early return; the lowered
// union keeps its undefined arm all the same.
function describe(thumbnail: Thumb | undefined): string {
  if (thumbnail === undefined) return "none";
  if ("bytes" in thumbnail) return `bytes:${thumbnail.bytes}`;
  return `stream:${thumbnail.contentLength}`;
}
console.log(describe(undefined));
console.log(describe({ bytes: 3 }));
console.log(describe({ contentLength: 9 }));

// The same shape with a `null` arm, and an optional slot on both sides so
// the per-value answer and the unit arm share one chain.
function hasWidth(thumbnail: Thumb | null): boolean {
  if (thumbnail === null) return false;
  return "width" in thumbnail;
}
console.log(hasWidth(null), hasWidth({ bytes: 1, width: 4 }), hasWidth({ bytes: 1 }), hasWidth({ contentLength: 2, width: 0 }));

// A LYING predicate: the unit arm survives, so it is genuinely reachable.
function isThumb(x: Thumb | undefined): x is Thumb {
  return true;
}
function isThumbOrNull(x: Thumb | null): x is Thumb {
  return true;
}
function probe(t: Thumb | undefined): string {
  if (isThumb(t)) return "bytes" in t ? "b" : "s";
  return "none";
}
function probeNull(t: Thumb | null): string {
  if (isThumbOrNull(t)) return "width" in t ? "w" : "-";
  return "none";
}
console.log(probe({ bytes: 1 }), probe({ contentLength: 1 }));
try {
  console.log(probe(undefined));
} catch (e) {
  console.log(`caught: ${(e as Error).name}: ${(e as Error).message}`);
}
try {
  console.log(probeNull(null));
} catch (e) {
  console.log(`caught: ${(e as Error).name}: ${(e as Error).message}`);
}

// The unit arm does not disturb a union whose record arms answer
// statically: `contentLength` is required on one arm and absent from the
// other, so those two terms stay constant either way.
function kindOf(t: Thumb | undefined): string {
  if (t === undefined) return "none";
  return "contentLength" in t ? "stream" : "bytes";
}
console.log(kindOf(undefined), kindOf({ bytes: 5 }), kindOf({ contentLength: 5 }));
