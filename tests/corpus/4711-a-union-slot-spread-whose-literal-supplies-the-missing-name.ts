// `return { ...normalized, errors }` — zapo's
// `src/client/events/mex-notification.ts:192`, the SC1090 the surveys graded
// "must-not-close, several hundred lines, INVENT the union arms".
//
// Nothing is invented. The source type is the slot's arms with one name
// REMOVED, and the literal puts that name back:
//
//     type WaMexNotificationParsed = ...the eight parsed arms...
//     type MexNormalizerOutput     = ...seven of them, minus `errors`...
//     return { ...normalized, errors }          // <- the eighth name
//
// Measured on the reduction with SCRIPTC_UNIONSLOT_WHY=1 at 3dd8af78, the
// site reports the blocker in two words:
//
//     ARMS=disjoint pairedByNames=0/2 srcArms=2/2 ctxArms=3/4
//     extras=[errors] extrasInEveryArm=false
//     NOT-CLOSED=arms-not-paired:[r0,r1]vs[r3,r4,r5]
//
// `pairArmsByFieldName` compared the shape the branch READS with the shape it
// must BUILD, and those are not the same shape when the literal supplies a
// name of its own. Two changes, and they are the two the measurement names:
//
//   * the PLAIN overrides join the SOURCE side of the pairing key. A plain
//     override is written into every branch unconditionally, so no source
//     read is ever emitted for it — which is why it belongs to the built
//     shape and not to the read one. A CONDITIONAL override does not join:
//     when its condition is false JS leaves the source's own field standing,
//     so that name still has to be readable from the source arm.
//   * the pairing is INJECTIVE, not bijective. Seven normalizer arms map onto
//     eight parsed arms; the eighth (`kind: "unknown"`) is the literal the
//     same function returns on its other path, and a slot arm no source arm
//     maps to is simply never built — the same reason the containment path
//     already gives for a narrowed source.
//
// FIVE things have to hold at once and this file pins all five:
//
//   * THE ZAPO SHAPE — source = slot minus one name, the literal supplies it.
//   * THE UNPAIRED SLOT ARM is never built. `Unknown` below carries required
//     fields (`opName`, `data`) no source arm has; a rebuild that reached it
//     would have nothing to put there.
//   * THE ARM IS THE SOURCE'S, read back through the DISCRIMINANT and not
//     through a printer. `Ack` and `Nack` carry one field-name set and one
//     interned shape, so a pairing that picked by anything looser than
//     "these exact names" would swap them.
//   * THE SOURCE IS EVALUATED ONCE — the desugar dispatches on the tag and
//     re-reads a hidden local per arm.
//   * THE OLD BASE CASES SURVIVE — identity, containment, equal-sized
//     by-name pairing, and a conditional override.
//
// Field ORDER: every arm declares its own members flat (no `extends`), and
// the supplied name is declared LAST everywhere, because Node's
// JSON.stringify follows insertion order (a spread inserts the source's keys,
// then an override appends a name the source did not have) while scriptc
// follows the interned shape's field order. Declared last on both sides, the
// two orders are the same order — so a differing line is a differing VALUE.

interface GqlError {
    readonly message: string;
    readonly code: number;
}

// ── the zapo relation ───────────────────────────────────────────────────
// Four slot arms; the source is three of them minus `errors`.

interface ProfileUpdate {
    readonly kind: "profile";
    readonly jid: string;
    readonly errors: readonly GqlError[];
}

interface Ack {
    readonly kind: "ack";
    readonly seq: number;
    readonly errors: readonly GqlError[];
}

// Ack and Nack carry the SAME field-name set and the same field types; they
// differ only in the literal type of `kind`, so they intern to one shape and
// one arm. The discriminant is a FIELD, copied from the source like every
// other, so a nack rebuilds as a nack.
interface Nack {
    readonly kind: "nack";
    readonly seq: number;
    readonly errors: readonly GqlError[];
}

// In the SLOT and not in the source: the arm the pairing must leave unbuilt.
interface Unknown {
    readonly kind: "unknown";
    readonly opName: string;
    readonly data: string;
    readonly errors: readonly GqlError[];
}

type Parsed = ProfileUpdate | Ack | Nack | Unknown;
type NormalizerOut = Omit<ProfileUpdate, "errors"> | Omit<Ack, "errors"> | Omit<Nack, "errors">;

function errText(e: readonly GqlError[]): string {
    let out = "";
    for (const x of e) {
        out += "[" + x.message + "/" + String(x.code) + "]";
    }
    return out === "" ? "-" : out;
}

function describe(p: Parsed): string {
    if (p.kind === "profile") {
        return "profile jid=" + p.jid + " err=" + errText(p.errors);
    }
    if (p.kind === "ack") {
        return "ack seq=" + String(p.seq) + " err=" + errText(p.errors);
    }
    if (p.kind === "nack") {
        return "nack seq=" + String(p.seq) + " err=" + errText(p.errors);
    }
    return "unknown op=" + p.opName + " data=" + p.data + " err=" + errText(p.errors);
}

// zapo's line, verbatim in shape: the union source, one plain override, a
// slot that also carries the arm the source cannot be, and a `| null` unit
// arm on the slot for good measure.
function attach(normalized: NormalizerOut, errors: readonly GqlError[]): Parsed | null {
    return { ...normalized, errors };
}

const noErr: readonly GqlError[] = [];
const oneErr: readonly GqlError[] = [{ message: "bad", code: 7 }];
const twoErr: readonly GqlError[] = [{ message: "a", code: 1 }, { message: "b", code: 2 }];

function show(p: Parsed | null): string {
    return p === null ? "null" : describe(p);
}

console.log(show(attach({ kind: "profile", jid: "5511@s.whatsapp.net" }, noErr)));
console.log(show(attach({ kind: "ack", seq: 12 }, oneErr)));
console.log(show(attach({ kind: "nack", seq: 13 }, twoErr)));

// The same arms again, out of order, so a rule that memoised the first arm it
// saw answers the second call wrong.
console.log(show(attach({ kind: "nack", seq: 21 }, noErr)));
console.log(show(attach({ kind: "profile", jid: "j2" }, twoErr)));
console.log(show(attach({ kind: "ack", seq: 22 }, twoErr)));

// The ack/nack collision read back through the DISCRIMINANT, not a printer.
function armOf(normalized: NormalizerOut): string {
    const out: Parsed | null = { ...normalized, errors: oneErr };
    if (out === null) {
        return "null";
    }
    if (out.kind === "nack") {
        return "nack-stays-nack";
    }
    if (out.kind === "ack") {
        return "ack-stays-ack";
    }
    return "other:" + out.kind;
}

console.log(armOf({ kind: "ack", seq: 1 }), armOf({ kind: "nack", seq: 2 }), armOf({ kind: "profile", jid: "p" }));
console.log(armOf({ kind: "nack", seq: 3 }), armOf({ kind: "ack", seq: 4 }));

// The arm the source cannot be is reachable only by writing it out, and its
// own required fields have no source to come from — proof that the unpaired
// slot arm is never what a spread builds.
const unknownArm: Parsed = { kind: "unknown", opName: "opX", data: "{}", errors: noErr };
console.log(describe(unknownArm));

// ── the source is evaluated ONCE ────────────────────────────────────────

let reads = 0;

function pick(which: number): NormalizerOut {
    reads += 1;
    if (which === 0) {
        return { kind: "profile", jid: "p" + String(reads) };
    }
    if (which === 1) {
        return { kind: "ack", seq: reads };
    }
    return { kind: "nack", seq: reads };
}

console.log(show(attach(pick(0), noErr)), "reads=" + String(reads));
console.log(show(attach(pick(1), oneErr)), "reads=" + String(reads));
console.log(show(attach(pick(2), twoErr)), "reads=" + String(reads));

// ── the supplied name may also be one the source HAS ────────────────────
// The literal wins, in every arm.

type WithErrors = ProfileUpdate | Ack;

function replace(p: WithErrors, errors: readonly GqlError[]): Parsed {
    return { ...p, errors };
}

console.log(describe(replace({ kind: "profile", jid: "j", errors: twoErr }, noErr)));
console.log(describe(replace({ kind: "ack", seq: 9, errors: twoErr }, oneErr)));

// JSON, where the two key orders provably agree (the supplied name is last on
// both sides): a differing line here is a differing value.
console.log(JSON.stringify(attach({ kind: "ack", seq: 44 }, oneErr)));
console.log(JSON.stringify(attach({ kind: "profile", jid: "jx" }, noErr)));

// ── a CONDITIONAL override is not an extra ──────────────────────────────
// Its false branch reads the source's own field, so the name has to be
// declared by every source arm — and here it is, so the site still closes and
// both branches answer.

interface JobIn {
    readonly kind: "job";
    readonly id: number;
    readonly note: string;
}

interface TaskIn {
    readonly kind: "task";
    readonly label: string;
    readonly note: string;
}

interface JobOut {
    readonly kind: "job";
    readonly id: number;
    readonly note: string;
    readonly stamp: string;
}

interface TaskOut {
    readonly kind: "task";
    readonly label: string;
    readonly note: string;
    readonly stamp: string;
}

function stamped(x: JobIn | TaskIn, override: boolean, stamp: string): JobOut | TaskOut {
    return { ...x, ...(override ? { note: "OVERRIDDEN" } : {}), stamp };
}

function showStamped(v: JobOut | TaskOut): string {
    return v.kind === "job"
        ? "job " + String(v.id) + " " + v.note + " " + v.stamp
        : "task " + v.label + " " + v.note + " " + v.stamp;
}

console.log(showStamped(stamped({ kind: "job", id: 1, note: "n1" }, false, "S1")));
console.log(showStamped(stamped({ kind: "job", id: 2, note: "n2" }, true, "S2")));
console.log(showStamped(stamped({ kind: "task", label: "L", note: "n3" }, false, "S3")));
console.log(showStamped(stamped({ kind: "task", label: "M", note: "n4" }, true, "S4")));

// ── the old base cases ──────────────────────────────────────────────────
// Generalising a rule is the classic way to lose its base case.

// EQUAL-SIZED by-NAME pairing, no extras.
interface SongIn { readonly title: string; readonly bitrate: number; readonly tag: string }
interface ClipIn { readonly title: string; readonly bitrate: number; readonly frames: number; readonly tag: string }
interface SongOut { readonly title: string; readonly bitrate: number | null; readonly tag: string }
interface ClipOut { readonly title: string; readonly bitrate: number | null; readonly frames: number; readonly tag: string }

function wrapWidened(x: SongIn | ClipIn): SongOut | ClipOut {
    return { ...x, tag: "done" };
}

console.log(JSON.stringify(wrapWidened({ title: "s", bitrate: 320, tag: "raw" })));
console.log(JSON.stringify(wrapWidened({ title: "c", bitrate: 96, frames: 24, tag: "raw" })));

// CONTAINMENT: a narrowed source into its own slot, still the identity path.
type Shape = SongOut | ClipOut;

function retag(s: Shape): Shape {
    if (s.bitrate === null) {
        return s;
    }
    return { ...s, tag: "kept" };
}

console.log(JSON.stringify(retag({ title: "s2", bitrate: 1, tag: "t" })));
console.log(JSON.stringify(retag({ title: "c2", bitrate: 2, frames: 3, tag: "t" })));
console.log(JSON.stringify(retag({ title: "s3", bitrate: null, tag: "t" })));
