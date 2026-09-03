// The NEGATIVE half of the function-type intersection rule (corpus
// 7395-a-base-signature-intersected-with-a-narrower-one.ts holds the
// positive half). Both programs below are that fixture's shape with exactly
// ONE thing changed, so what is being pinned is the rule and not the shape.
//
// The rule keeps ONE constituent of an intersection of function types, and
// it may only because every DISCARDED constituent returns `unknown` — the
// top type, which constrains nothing, so the kept signature describes every
// value of the intersection exactly and Node's single closure has a name.
//
//   1. the base returns `string` instead of `unknown`. Now the value must
//      answer BOTH `(ctx) => string` and `(ctx) => Coord`, which no compiled
//      function does. There is no constituent to keep.
//   2. the two signatures take DIFFERENT parameters. Those are two
//      functions, not one function described twice.
//
// Either way, picking a constituent would be a guess that silently drops the
// other half — the exact silent wrong answer the rule's narrowness exists to
// avoid. If this file ever compiles, the rule has been widened past what
// makes it sound.

interface Ctx {
    readonly id: string;
}
interface Other {
    readonly n: number;
}

class Coord {
    readonly id: string;
    constructor(id: string) {
        this.id = id;
    }
}

/* ── 1. unrelated returns: `string` and `Coord` ──────────────────────── */
interface StringBase {
    readonly id: string;
    readonly setup: (ctx: Ctx) => string;
}
declare function defineOverString<T>(input: {
    readonly id: string;
    readonly setup: (ctx: Ctx) => T;
}): StringBase & { readonly setup: (ctx: Ctx) => T };

export function unrelatedReturns() {
    return defineOverString<Coord>({
        id: "@x/unrelated",
        setup(ctx) {
            return new Coord(ctx.id);
        },
    });
}

/* ── 2. different parameter lists ────────────────────────────────────── */
interface UnknownBase {
    readonly id: string;
    readonly setup: (ctx: Ctx) => unknown;
}
declare function defineOverOther<T>(input: {
    readonly id: string;
    readonly setup: (o: Other) => T;
}): UnknownBase & { readonly setup: (o: Other) => T };

export function differentParams() {
    return defineOverOther<Coord>({
        id: "@x/params",
        setup(o) {
            return new Coord(String(o.n));
        },
    });
}

console.log("unrelated:", typeof unrelatedReturns());
console.log("params:", typeof differentParams());
