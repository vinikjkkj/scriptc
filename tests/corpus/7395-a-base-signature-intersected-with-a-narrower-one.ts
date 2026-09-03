// An intersection of FUNCTION types where the base promises the loosest
// signature it can and a generic helper's return type re-declares it at the
// instantiated one:
//
//   interface Definition { setup: (ctx: Ctx) => unknown }
//   declare function define<K extends string, T>(...):
//       Definition & { exposeAs: K; setup: (ctx: Ctx) => T }
//
// The OUTER intersection is an ordinary record merge. It used to fail
// anyway, because it could not intern the `setup` FIELD — whose type is the
// nested `((ctx: Ctx) => unknown) & ((ctx: Ctx) => Coord)` — and the whole
// value reported
//
//   SC2008: values of type 'Definition & { readonly exposeAs: "wam"; … }'
//   cannot be compiled: this intersection resolves to no runtime shape
//
// `unknown` constrains nothing, so `(P) => unknown` is the TOP function type
// over its parameter list: every value of the intersection is a function of
// the OTHER signature, and Node stores exactly one closure. Keeping the
// narrower constituent names that closure and discards nothing.
//
// This is `defineWaClientPlugin`'s shape verbatim, and it was the last thing
// between zapo's `@zapo-js/wam` and a build: with the package's attested
// source compiled, its entry was down to this one refusal plus the SC2004
// that inherits from it, over 46,036 statements.
//
// What must STILL refuse — two function types whose returns are unrelated,
// and two whose parameter lists differ — is pinned in
// tests/diagnostics/function-intersection-unrelated-returns.ts, which this
// program cannot host because it must build.

interface Ctx {
    readonly id: string;
}

interface Definition {
    readonly id: string;
    readonly exposeAs?: string;
    readonly setup: (ctx: Ctx) => unknown;
}

interface ExposeInput<K extends string, T> {
    readonly id: string;
    readonly exposeAs: K;
    readonly setup: (ctx: Ctx) => T;
}

class Coord {
    readonly ctx: Ctx;
    constructor(ctx: Ctx) {
        this.ctx = ctx;
    }
    tag(): string {
        return `coord:${this.ctx.id}`;
    }
}

function define<K extends string, T, E = {}>(
    input: ExposeInput<K, T> & { readonly exposeAs: K },
): Definition & {
    readonly exposeAs: K;
    readonly setup: (ctx: Ctx) => T;
    readonly __pluginEvents?: E;
} {
    return input;
}

const plugin = define<"wam", Coord>({
    id: "@x/wam",
    exposeAs: "wam",
    setup(ctx) {
        return new Coord(ctx);
    },
});

console.log("1 id:", plugin.id);
console.log("2 exposeAs:", plugin.exposeAs);
console.log("3 setup is a function:", typeof plugin.setup);

// CALLING through the field is the consumer's job, and TypeScript decides
// its static type, not this mapping: an intersection resolves calls in
// constituent order, so `plugin.setup(ctx)` is typed `unknown` — the BASE's
// answer — and every consumer must cast. That is exactly why the narrower
// mapping cannot produce a wrong answer through a call: the checker gates
// every use of the result, and the cast is checked against the value that
// really comes back.
const made = plugin.setup({ id: "s1" }) as Coord;
console.log("4 tag:", made.tag());
console.log("5 ctx id:", made.ctx.id);

// A second instantiation of the same helper, at a different T, so the
// mapping is not a one-shape accident.
function idOf(ctx: Ctx): string {
    return ctx.id.toUpperCase();
}
const plugin2 = define<"names", string>({
    id: "@x/names",
    exposeAs: "names",
    setup: idOf,
});
console.log("6 second exposeAs:", plugin2.exposeAs);
console.log("7 second setup:", plugin2.setup({ id: "abc" }) as string);

// …and one whose T is a plain record, read field by field.
const plugin3 = define<"pair", { readonly a: number; readonly b: string }>({
    id: "@x/pair",
    exposeAs: "pair",
    setup(ctx) {
        return { a: ctx.id.length, b: ctx.id };
    },
});
const pair = plugin3.setup({ id: "xyz" }) as { readonly a: number; readonly b: string };
console.log("8 pair:", pair.a, pair.b);

export {};
