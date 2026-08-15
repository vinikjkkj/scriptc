// Spreading a union-typed source into a union-typed slot, and the remedy
// the fence advises.
//
// `{ ...base, ...parsed }` where `parsed` is a union with SEVERAL record
// arms has no single shape to build: which arm the result inhabits is not
// known until run time, and an object literal builds one shape. zapo hits
// this at three sites (`client/events/incoming.ts:397`,
// `client/events/mex-notification.ts:192`,
// `message/addons/link-preview/fetcher.ts:91`), and until now all three
// reported SC2011 — "values of type 'X' have no static representation but
// run in the embedded dynamic engine". Both halves were false: mapType
// answers a union for exactly the type the message named, and `--dynamic`
// refuses the same site with SC2001. The refusal now names the construct
// and the remedy; `tests/diagnostics/union-spread-into-union-slot.ts`
// pins that message.
//
// THIS file is the remedy's proof: narrow the source first and every one
// of these spreads compiles, because the narrowed source is a plain record
// and the literal's own shape IS one of the slot's arms. r01-r04 are the
// narrowed spellings; r05-r08 are the controls that already compiled and
// must answer exactly what they answered before — a single-record-arm
// union source (the `{ ...DEFAULTS, ...overrides }` merge, which the
// per-field present-test path owns and the new fence must not touch), a
// spread into a plain record slot, a spread with no union anywhere, and a
// literal against a union slot with no spread at all.

interface Base {
    readonly rawId: string
}

interface ArmA {
    readonly kind: "a"
    readonly lidJid: string
}

interface ArmB {
    readonly kind: "b"
    readonly oldLidJid: string
}

type Parsed = ArmA | ArmB

interface EvA extends Base {
    readonly kind: "a"
    readonly lidJid: string
}

interface EvB extends Base {
    readonly kind: "b"
    readonly oldLidJid: string
}

type Ev = EvA | EvB

function pick(n: number): Parsed | null {
    if (n === 0) return { kind: "a", lidJid: "L0" };
    if (n === 1) return { kind: "b", oldLidJid: "O1" };
    return null;
}

function show(e: Ev): string {
    return e.kind === "a"
        ? "a|" + e.lidJid + "|" + e.rawId
        : "b|" + e.oldLidJid + "|" + e.rawId;
}

const base: Base = { rawId: "R" };

// r01/r02 — the remedy: narrow the union source, then spread. The literal's
// own shape is one of the slot's arms, so the ordinary record path builds it.
const p0 = pick(0);
if (p0 !== null && p0.kind === "a") {
    console.log("r01", show({ ...base, ...p0 }));
}
const p1 = pick(1);
if (p1 !== null && p1.kind === "b") {
    console.log("r02", show({ ...base, ...p1 }));
}

// r03 — the narrowed spread with an explicit field beside it.
const p2 = pick(0);
if (p2 !== null && p2.kind === "a") {
    console.log("r03", show({ ...p2, rawId: "R3" }));
}

// r04 — narrowing by a `null` test alone, where the remaining union still
// has one record arm: the single-arm path, reached through the same spread.
function widen(n: number): ArmA | null {
    return n === 0 ? { kind: "a", lidJid: "L4" } : null;
}
const p3 = widen(0);
if (p3 !== null) {
    console.log("r04", show({ ...base, ...p3 }));
}

// r05 — CONTROL: a single-record-arm union source (`X | undefined`) into a
// plain record slot. This is the optional-options merge the per-field
// present-test desugar owns; the new fence requires TWO record arms and
// must leave it exactly as it was.
interface Opts {
    readonly host: string
    readonly port: number
}
function merged(overrides: { readonly port: number } | undefined): Opts {
    return { host: "h", port: 1, ...overrides };
}
console.log("r05", merged(undefined).port, merged({ port: 9 }).port);

// r06 — CONTROL: a multi-arm union source spread into a plain RECORD slot
// (not a union slot). The fence is gated on the slot being a union, so this
// keeps whatever answer it had.
interface Flat {
    readonly kind: string
}
function flatten(p: Parsed): Flat {
    return { kind: p.kind };
}
console.log("r06", flatten({ kind: "a", lidJid: "L6" }).kind);

// r07 — CONTROL: a spread with no union on either side.
console.log("r07", show({ ...base, kind: "a", lidJid: "L7" }));

// r08 — CONTROL: a literal against a union slot with NO spread. Arm
// selection by the literal's own shape, untouched by this change.
console.log("r08", show({ rawId: "R8", kind: "b", oldLidJid: "O8" }));
