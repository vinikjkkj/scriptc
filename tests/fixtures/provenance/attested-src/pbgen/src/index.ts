import type { waproto } from "../spec/proto/index.js";

/* The VALUE re-export (zapo-js's `src/proto.ts` spelling). It is what puts
 * the generated declaration file into module order, which is what pulls
 * its implementation twin in with it — without this edge the declaration
 * is type-only and the twin is never compiled, so the case would silently
 * test the declaration-ONLY rule instead. */
export { waproto as proto } from "../spec/proto/index.js";

/** The decoded value's type: `Msg & Msg.$Shape` — a declaration-file CLASS
 * intersected with its own properties interface, which is what the
 * generator gives `decode` as a return type. The generated module's own
 * VALUES fence at their gates (its twin is a trap-only island init), so
 * the shape only ever has to hold records this program built — exactly the
 * soundness argument the flattening rests on. */
export type Decoded = waproto.Msg & waproto.Msg.$Shape;

function build(bytes: Uint8Array): Decoded {
  return { details: bytes, signature: new Uint8Array([7, 7]), count: bytes.length };
}

/** The pairing-flow shape that exposed this: an async function whose
 * Promise payload carries the intersection in a field. */
async function decodeInto(
  bytes: Uint8Array,
): Promise<{ readonly message: Decoded; readonly index: number }> {
  return { message: build(bytes), index: 3 };
}

function detailLength(m: Decoded): number {
  return m.details ? m.details.length : -1;
}

/** One string out, so the driver's console.log stays about provenance
 * rather than about printing the shape. */
export async function describe(bytes: Uint8Array): Promise<string> {
  const r = await decodeInto(bytes);
  const sig = r.message.signature;
  return `${detailLength(r.message)} ${r.message.count ?? -1} ${sig ? sig.length : -1} ${r.index}`;
}
