// `Array.isArray` over a READONLY array arm, one hop further out than the
// checker can follow.
//
// `Array.isArray` is declared `arg is any[]`, and a `readonly T[]`
// constituent is not assignable to `any[]`, so tsc's true branch comes out
// bare `any[]` with T gone. maybeNarrow's isArray bridge already answers
// that: the read's checker type IS `any[]`, which is tsc's own record of the
// guard, and the lowered union has exactly one array arm, so the value
// bridges to it through the tag-checked helper.
//
// One hop out the checker has nothing left to record. In
//   const t = Array.isArray(n.content) ? n.content.find(...) : undefined
// the quirk poisons the ternary's result, so `t` is bare `any` and
// `t.content` inside a SECOND `Array.isArray` guard is `any`, not `any[]`.
// The VALUE was a real union the whole way (the field read already lowered
// it), and the guard is right there in the source — so the guard is read off
// the SOURCE instead of off a narrowing tsc never made:
//   SC2011 values of type 'any' run in the embedded dynamic engine, which
//          this build does not include
// zapo's `parseTosQueryResponse` (transport/node/builders/tos.ts:60) is that
// site, and the fence throws BEFORE the loop body is lowered.
//
// The rule is narrow on purpose and each condition has its own decline
// control (named at the bottom): only a read the checker gave up on ENTIRELY moves, only
// the TRUE side of an if/ternary/`&&`, never across a function boundary,
// never when the guarded region writes the reference's root, and only when
// the lowered union has EXACTLY ONE array arm. The extraction is the same
// tag-checked bridge every checker-driven union narrowing uses.

interface BinaryNode {
    readonly tag: string;
    readonly attrs: Readonly<Record<string, string>>;
    readonly content?: Uint8Array | string | readonly BinaryNode[];
}

function parseOptionalInt(v: string | undefined): number | undefined {
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
}

// zapo's parseTosQueryResponse, verbatim in shape.
function parseTos(node: BinaryNode): { readonly refreshSeconds: number; readonly notices: readonly { readonly id: string; readonly accepted: boolean }[] } {
    const tosNode = Array.isArray(node.content)
        ? node.content.find((child) => child.tag === "tos")
        : undefined;
    if (!tosNode) {
        throw new Error("tos response missing <tos> node");
    }
    const refreshSeconds = parseOptionalInt(tosNode.attrs.refresh) ?? 0;
    const notices: { readonly id: string; readonly accepted: boolean }[] = [];
    if (Array.isArray(tosNode.content)) {
        for (const child of tosNode.content) {
            if (child.tag !== "notice") continue;
            const id = child.attrs.id;
            if (!id) continue;
            notices.push({ id, accepted: child.attrs.state !== "false" });
        }
    }
    return { refreshSeconds, notices };
}

const iq: BinaryNode = {
    tag: "iq",
    attrs: { from: "s.whatsapp.net" },
    content: [
        { tag: "other", attrs: {} },
        {
            tag: "tos",
            attrs: { refresh: "86400" },
            content: [
                { tag: "notice", attrs: { id: "20", state: "false" } },
                { tag: "notice", attrs: { id: "21" } },
                { tag: "junk", attrs: {} },
                { tag: "notice", attrs: { id: "", state: "true" } },
                { tag: "notice", attrs: { id: "22", state: "true" } },
            ],
        },
    ],
};
const parsed = parseTos(iq);
console.log(parsed.refreshSeconds);
console.log(JSON.stringify(parsed.notices));
console.log(JSON.stringify(parseTos({ tag: "iq", attrs: {}, content: [{ tag: "tos", attrs: {} }] })));
console.log(JSON.stringify(parseTos({ tag: "iq", attrs: {}, content: [{ tag: "tos", attrs: { refresh: "x" }, content: "text" }] })));

// The guard also proves an `&&` RIGHT operand and a ternary's TRUE arm, and
// an argument position and an annotated binding ride it as well as a for-of.
//
// A direct member read off the guarded reference (`t.content.length`) does
// NOT: it keeps `SC1090 reading 'length' from a value of type 'any'`, because
// the property-read path answers from the lowered receiver before this
// bridge is consulted. Measured (repro-fy/lab/fy39v-lengthread.ts); the
// mechanism behind it is a structural reading and is not measured. zapo's
// site does not need it, and widening it is its own unit of work.
function sizeOf(xs: readonly BinaryNode[]): number { return xs.length }
function countVia(node: BinaryNode): string {
    const t = Array.isArray(node.content) ? node.content.find((c) => c.tag === "tos") : undefined;
    if (!t) return "none";
    let viaAnd = 0;
    if (Array.isArray(t.content) && t.tag === "tos") { for (const _c of t.content) viaAnd += 1 }
    const viaTernary = Array.isArray(t.content) ? sizeOf(t.content) : -1;
    let viaArg = -1;
    if (Array.isArray(t.content)) viaArg = sizeOf(t.content);
    const viaAndArg = Array.isArray(t.content) && sizeOf(t.content) > 0 ? 1 : 0;
    let viaBinding = -1;
    if (Array.isArray(t.content)) { const xs: readonly BinaryNode[] = t.content; viaBinding = xs.length }
    return [viaAnd, viaTernary, viaArg, viaAndArg, viaBinding].join(",");
}
console.log(countVia(iq));
console.log(countVia({ tag: "iq", attrs: {}, content: [{ tag: "tos", attrs: {} }] }));

// CONTROL — the annotated spelling, which compiled all along and must keep
// answering identically.
function parseTosAnnotated(node: BinaryNode): number {
    const t: BinaryNode | undefined = Array.isArray(node.content)
        ? node.content.find((child) => child.tag === "tos")
        : undefined;
    if (!t) return -1;
    let k = 0;
    if (Array.isArray(t.content)) {
        for (const child of t.content) if (child.tag === "notice") k += 1;
    }
    return k;
}
console.log(parseTosAnnotated(iq));

// CONTROL — the direct one-hop shape, which the checker's own `any[]`
// narrowing already answered.
function direct(node: BinaryNode): number {
    let k = 0;
    if (Array.isArray(node.content)) {
        for (const child of node.content) if (child.tag === "tos") k += 1;
    }
    return k;
}
console.log(direct(iq));

// The DECLINE CONTROLS live beside this fixture rather than in it: two array
// arms, an else-side read, a read inside a nested function and a read of a
// DIFFERENT reference are HARD compile errors, which a corpus program that
// must run cannot carry. They are `repro-fy/lab/fy39j-twoarrayarms.ts`,
// `fy39k-elsearm.ts`, `fy39m-nestedfn.ts` and `fy39n-otherref.ts`, and all
// four keep their fence on this branch.
