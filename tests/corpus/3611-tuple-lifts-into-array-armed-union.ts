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
// The shape that found it is zapo's, and it is as ordinary as code gets:
//
//     function pairLidPn(a, b) {
//         if (!a || !b) return null;
//         if (isLidJid(a) && isUserJid(b)) return [a, b];
//         if (isLidJid(b) && isUserJid(a)) return [b, a];
//         return null;
//     }
//
// Both value-returning paths threw. It sits on the incoming-message path
// (handleIncomingMessageEvent -> persistIncomingMailboxEntities ->
// persistContacts -> canonicalContact -> pairLidPn), so every contact
// persisted for an incoming message hit it — which is also why no QR sweep
// ever saw it.
//
// The bridge already existed: `tupleArrayWidthHelper` rebuilds the tuple as a
// fresh array, position by position, and `widthCoerce` has used it for a
// plain `string[]` slot since the const-table rule was written. All that was
// missing was letting the same pair meet ONE ARM IN. So this is not a new
// stance — it makes the union-arm position agree with the plain slot one arm
// over, copy semantics included (SEMANTICS.md 35: the rebuilt array does not
// alias the tuple; that is already true today for the non-union slot, and
// this fixture asserts nothing about aliasing because Node's answer there is
// the documented divergence, not this rule).
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

// The tuple is built by a callee whose RETURN TYPE is the tuple, which is
// what keeps the positional record alive across the boundary: an inline
// literal in a `string[]`-contextual position is typed as the array outright
// and never becomes a tuple at all.
function pair(a: string, b: string): [string, string] {
    return [a, b];
}

function pairLidPn(a: string | undefined, b: string | undefined): string[] | null {
    if (!a || !b) {
        return null;
    }
    if (isLidJid(a) && isUserJid(b)) {
        return pair(a, b);
    }
    if (isLidJid(b) && isUserJid(a)) {
        return pair(b, a);
    }
    return null;
}

const LID = "123456789012345@lid";
const PN = "5511999999999@s.whatsapp.net";

// Path one: the LID arrives first.
const forward = pairLidPn(LID, PN);
console.log("forward", forward === null ? "null" : forward.join("|"));

// Path two: the LID arrives second, so the pair is built in the other order.
const reverse = pairLidPn(PN, LID);
console.log("reverse", reverse === null ? "null" : reverse.join("|"));

// The null paths are untouched.
console.log("none", pairLidPn(undefined, PN) === null, pairLidPn(LID, undefined) === null);
console.log("neither", pairLidPn("plain", "other") === null);

// The value that comes out really is an ARRAY, not a record wearing an
// array's type: length, indexed reads, destructuring, iteration, a method
// that only arrays have, and JSON (a tuple must serialize as an array).
const got = forward;
if (got !== null) {
    const [lid, pn] = got;
    console.log("destructured", lid, pn);
    console.log("length", got.length, "index", got[0], got[1]);
    console.log("map", got.map((s) => s.length).join(","));
    console.log("json", JSON.stringify(got));
    let seen = "";
    for (const part of got) {
        seen += `<${part}>`;
    }
    console.log("iterated", seen);
    // It is a real array object, so array mutation works on it.
    got.push("extra");
    console.log("pushed", got.length, got.join("|"));
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
// strand exactly the same way.
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
// literal below is a plain record and reaches the record arm on the first
// pass, exactly as before, even though an array arm sits next to it.
interface Row {
    readonly id: string;
}

function rowOrList(useRow: boolean): Row | string[] {
    return useRow ? { id: "r1", extra: "dropped" } as Row : ["a", "b"];
}

const asRow = rowOrList(true);
console.log("row", Array.isArray(asRow) ? "array" : asRow.id);
const asList = rowOrList(false);
console.log("list", Array.isArray(asList) ? asList.join(",") : "row");
