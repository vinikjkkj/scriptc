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

/* The TABLE half: a generated value whose declaration spells each `parts`
 * field as a MIXED readonly TUPLE while the compiled twin builds an array
 * literal. The re-export is what puts it in module order, exactly as the
 * `proto` one above does. */
export { TABLE } from "../spec/proto/index.js";
import { TABLE, type Part, type Schema } from "../spec/proto/index.js";

/* The RE-EXPORT-ONLY edge (zapo-js's `src/version-spec.ts` and `src/mex.ts`
 * are nothing but this line). No import declaration names this module
 * anywhere in the package, so it is the module-edge STATEMENT SHAPE alone
 * that decides whether the twin's %init is scheduled. It was not: the
 * reader got the twin's GLOBAL and the header kept calling the declaration
 * file's empty init, leaving the storage NULL. `TABLE` above cannot cover
 * this — the import on the line above it schedules that twin either way. */
export { GEN_VERSION, GEN_LIMITS } from "../spec/version/index.js";

/** A GENERIC slot over the declared schema — the shape that fenced in
 * zapo (`buildSetMutationFromSchema<S extends WaAppstateSchema>`): the
 * parameter type is the declaration's, the argument is the value the twin
 * built. */
function render<S extends Schema>(input: { readonly schema: S; readonly sep: string }): string {
  const out: string[] = [];
  for (let i = 0; i < input.schema.parts.length; i += 1) {
    const p: Part = input.schema.parts[i]!;
    out.push(p.kind === "literal" ? p.value : `<${p.label}>`);
  }
  return `${input.schema.name}@${input.schema.version}:${out.join(input.sep)}`;
}

/** A PLAIN consumer typed by the declaration: the value has to enter a
 * slot the declaration spells as the tuple. */
function arity(s: Schema): number {
  return s.parts.length;
}

/** One string out, so the driver's console.log stays about provenance
 * rather than about printing the shape. */
export async function describe(bytes: Uint8Array): Promise<string> {
  const r = await decodeInto(bytes);
  const sig = r.message.signature;
  return `${detailLength(r.message)} ${r.message.count ?? -1} ${sig ? sig.length : -1} ${r.index}`;
}

/** The table half of the driver's output: the three arities, the three
 * renders through the generic slot, and a direct element read off the
 * table. */
export function describeTable(): string {
  // Read through the DECLARED interface, which is the face every consumer
  // of a generated table has. (A `const` whose own type the checker spells
  // as the bare tuple — `const p = TABLE.Star.parts` — still takes the
  // positional record and still fences: this rule aligns the declared
  // FIELD with its implementation, not every spelling of the tuple.)
  const star: Schema = TABLE.Star;
  return [
    `${arity(TABLE.Ping)}${arity(TABLE.Mute)}${arity(TABLE.Star)}`,
    render({ schema: TABLE.Ping, sep: "-" }),
    render({ schema: TABLE.Mute, sep: "-" }),
    render({ schema: TABLE.Star, sep: "-" }),
    `${star.parts.length}${star.parts[0]!.kind}`,
  ].join(" ");
}

/* The CJS-WHOLE-EXPORT edge (spec/wire): a generated CommonJS module whose
 * `module.exports = <identifier>` leaves every declared export without a
 * binding of its own name. Both spellings are here — the re-export that
 * carries the module edge, and the import the body calls through — because
 * the declaration-twin export bridge has to answer for both. */
export { wire, WIRE_TAG } from "../spec/wire/index.js";
import { wire, WIRE_TAG } from "../spec/wire/index.js";

/** A STATIC method call through the declaration, which is the whole point:
 * the body it needs lives in the twin, attached to the root object at run
 * time, and the declaration half has no storage the call could reach. */
export function describeWire(): string {
  return `${wire.Frame.encode({ n: 21, tag: "f" })} ${WIRE_TAG} ${WIRE_TAG.length}`;
}
