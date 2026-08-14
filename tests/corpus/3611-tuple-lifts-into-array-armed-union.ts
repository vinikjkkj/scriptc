// A TUPLE flowing into a union that carries an ARRAY arm is a sound
// assignment — tsc gives `[string, string]` to `string[]` for free — and it
// used to compile to an UNCONDITIONAL runtime throw.
//
// `widthLiftPlan`'s union-destination rule scores each arm by FAMILY before
// asking whether the pair lifts: record→record, array→array, object→record,
// record→object, func→func. A monomorphic tuple is a positional RECORD, so a
// tuple source against an ARRAY arm matched no family, found zero candidate
// arms, and fell through to `strandedCoercionTrap` — a helper with NO tag
// test, whose entire body is `throw`. Reaching the call site was throwing.
//
// `pairLidPn` below is zapo's, copied verbatim from its source, and it is as
// ordinary as code gets. It sits on the incoming-message path
// (handleIncomingMessageEvent -> persistIncomingMailboxEntities ->
// persistContacts -> canonicalContact -> pairLidPn), so every contact
// persisted for an incoming message reached it — and its caller wraps the
// whole body in a try/catch that turns the throw into a logged warning, so
// the failure was SILENT: contacts simply stopped being written. Nothing on
// the QR path calls it, which is why every QR sweep stayed green.
//
// The `readonly` is what makes the two sides disagree, and it is not a typo:
// a UNIFORM readonly tuple rides the ARRAY representation (the `as const`
// const-table rule), so the arm maps to `string[]` — while the array literal
// the function returns is typed as the mutable tuple `[string, string]` and
// maps to a positional record. Same type to tsc, two representations here,
// and no bridge between them at the arm.
//
// The bridge already existed everywhere else: `tupleArrayWidthHelper` rebuilds
// the tuple as a fresh array, position by position, and `widthCoerce` has used
// it for a plain `string[]` slot since the const-table rule was written. All
// that was missing was letting the same pair meet ONE ARM IN. So this is not a
// new stance — it makes the union-arm position agree with the plain slot one
// arm over, copy semantics included (SEMANTICS.md 35: the rebuilt array does
// not alias the tuple, which is already true today for the non-union slot).
// This fixture asserts nothing about aliasing for that reason.
//
// The new family is consulted in a SECOND pass, only when the same-family
// pass found nothing, so a union that already had exactly one candidate can
// never be made ambiguous by it — and two array arms a tuple can both reach
// stay ambiguous and keep declining, as every width lift does.

function isLidJid(jid: string): boolean {
    return jid.endsWith("@lid");
}

function isUserJid(jid: string): boolean {
    return jid.endsWith("@s.whatsapp.net");
}

// zapo's function, verbatim.
function pairLidPn(a: string | undefined, b: string | undefined): readonly [string, string] | null {
    if (!a || !b) return null;
    if (isLidJid(a) && isUserJid(b)) return [a, b];
    if (isLidJid(b) && isUserJid(a)) return [b, a];
    return null;
}

// ...and its caller, also verbatim, which is what makes the pair observable.
function canonicalContact(
    primary: string,
    alt: string | undefined,
    nowMs: number
): { readonly jid: string; readonly phoneNumber?: string; readonly lastUpdatedMs: number } {
    const pair = pairLidPn(primary, alt);
    if (pair) {
        const [lid, pn] = pair;
        return { jid: lid, phoneNumber: pn, lastUpdatedMs: nowMs };
    }
    return { jid: primary, lastUpdatedMs: nowMs };
}

const LID = "123456789012345@lid";
const PN = "5511999999999@s.whatsapp.net";

// Path one: the LID arrives first. Path two: the other order, which is a
// SECOND stranded return in the same function — both had to be fixed.
const forward = canonicalContact(LID, PN, 7);
console.log("forward", forward.jid, forward.phoneNumber ?? "-", forward.lastUpdatedMs);
const reverse = canonicalContact(PN, LID, 8);
console.log("reverse", reverse.jid, reverse.phoneNumber ?? "-", reverse.lastUpdatedMs);

// The null paths are untouched: no alternate addressing, and two jids that
// pair with nothing.
const alone = canonicalContact(LID, undefined, 9);
console.log("alone", alone.jid, alone.phoneNumber ?? "-", alone.lastUpdatedMs);
const neither = canonicalContact("plain", "other", 10);
console.log("neither", neither.jid, neither.phoneNumber ?? "-");

// The value that comes out really is an ARRAY, not a record wearing an
// array's type: length, indexed reads, iteration, a method only arrays have,
// and JSON (a tuple must serialize as an array).
const got = pairLidPn(LID, PN);
if (got !== null) {
    console.log("length", got.length, "index", got[0], got[1]);
    console.log("map", got.map((s) => s.length).join(","));
    console.log("json", JSON.stringify(got));
    let seen = "";
    for (const part of got) {
        seen += `<${part}>`;
    }
    console.log("iterated", seen);
}

// The MUTABLE tuple spelling reaches the same plan, through a callee whose
// declared return type keeps the positional record alive across the boundary
// (an inline literal in a `string[]`-contextual position is typed as the
// array outright and never becomes a tuple at all).
function pair(a: string, b: string): [string, string] {
    return [a, b];
}

function pairOrNull(on: boolean): string[] | null {
    return on ? pair("l", "r") : null;
}

const mutable = pairOrNull(true);
console.log("mutable", mutable === null ? "null" : mutable.join("/"));
console.log("mutable-none", pairOrNull(false) === null);

// It is a real array object, so array mutation works on the result.
if (mutable !== null) {
    mutable.push("extra");
    console.log("pushed", mutable.length, mutable.join("|"));
}

// The positions are LIFTED, not merely copied: each element goes through the
// element type's own conversion, so a tuple of numbers reaches a union-element
// array by wrapping every position.
function mixedPair(x: number, y: number): [number, number] {
    return [x, y];
}

function widen(x: number, y: number): (number | string)[] | undefined {
    if (x < 0) {
        return undefined;
    }
    return mixedPair(x, y);
}

const widened = widen(3, 4);
console.log("widened", widened === undefined ? "undefined" : widened.join("+"));
console.log("widened-none", widen(-1, 0) === undefined);

// Arity is not special-cased at two.
function triple(a: string, b: string, c: string): [string, string, string] {
    return [a, b, c];
}

function tripleOrNull(on: boolean): string[] | null {
    return on ? triple("x", "y", "z") : null;
}

const three = tripleOrNull(true);
console.log("three", three === null ? "null" : `${three.length}:${three.join("")}`);

// The NESTED position — a tuple-typed field copying into a record field whose
// type is the array-armed union. This is the same plan reached through
// `recordWidthHelper` rather than through a top-level coercion, and it used to
// refuse with an SC2002 fence for the same reason.
interface Source {
    readonly name: string;
    readonly parts: [string, string];
}

interface Target {
    readonly name: string;
    readonly parts: string[] | null;
}

function narrow(s: Source): Target {
    return s;
}

const nested = narrow({ name: "row", parts: pair("l", "r") });
console.log("nested", nested.name, nested.parts === null ? "null" : nested.parts.join("/"));

// A union whose only array arm is reached through a WIDER element type still
// picks that one arm — one candidate, no ambiguity.
function toWide(a: string, b: string): unknown[] | null {
    return pair(a, b);
}

const wide = toWide("u", "v");
console.log("wide", wide === null ? "null" : `${wide.length}:${String(wide[0])}${String(wide[1])}`);

// A union that ALREADY had a same-family candidate keeps it: the object
// literal below is a plain record and reaches the record arm on the FIRST
// pass, exactly as before, even though an array arm sits next to it. The
// tuple-into-array family runs only when that pass came up empty, which is
// what keeps it from turning a working lift into an ambiguous one.
interface Row {
    readonly id: string;
}

function rowOrList(useRow: boolean): Row | string[] {
    return useRow ? ({ id: "r1", extra: "dropped" } as Row) : ["a", "b"];
}

const asRow = rowOrList(true);
console.log("row", Array.isArray(asRow) ? "array" : asRow.id);
const asList = rowOrList(false);
console.log("list", Array.isArray(asList) ? asList.join(",") : "row");
