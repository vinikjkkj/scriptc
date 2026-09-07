// `Object.freeze` over a fresh local whose initializer is written BEHIND A
// CAST.
//
// The freeze lowering's theorem is "nothing else holds this value when the
// freeze runs, so its frozen bit is unobservable". `freezeFreshLocal`
// proves it by requiring the binding's initializer to BE the allocation —
// an array or object literal — and then walking every other reference.
// It read the initializer bare, so `const acc = [] as string[]` failed the
// very first test while `const acc: string[] = []` passed it: the same
// allocation at the same place, refused for its spelling. The argument
// position one function up already reads through exactly these three
// wrappers (`as`, `satisfies`, parentheses, and the angle-bracket
// assertion), for exactly this reason — a cast is a type-level no-op that
// creates no reference.
//
// It is not always a free choice between the two spellings, either. A
// shape tsc will not let an annotation accept has the cast as its ONLY
// spelling: `const view = {} as Record<Name, Entry | undefined>` is
// rejected as an annotation (`{}` is missing every required key) and
// accepted as an assertion, which is what zapo-js 1.8.2's
// `protocol/abprops.ts` writes to build its `@deprecated` legacy view. The
// gap was the whole fence there — `:55`, SC2020, one of the arm's last
// diagnostics — and it had nothing to do with freezing.
//
// The shapes the proof DECLINES keep their SC2020 and so cannot appear in
// a corpus program (it must build). The one this file is about is pinned
// from outside in tests/diagnostics/freeze-behind-a-cast.ts: a cast over
// something that is not a literal unwraps to a non-literal and declines,
// because there the allocation really is somebody else's.

// ── The plain array accumulator, both spellings ──────────────────────────

function annotated(urls: readonly string[]): readonly string[] {
    const out: string[] = [];
    for (const u of urls) {
        if (out.indexOf(u) === -1) out.push(u);
    }
    return Object.freeze(out);
}

function behindACast(urls: readonly string[]): readonly string[] {
    const out = [] as string[];
    for (const u of urls) {
        if (out.indexOf(u) === -1) out.push(u);
    }
    return Object.freeze(out);
}

const src = ["b", "a", "b", "c", "a"];
console.log(annotated(src).join("|"));
console.log(behindACast(src).join("|"));
console.log(behindACast([]).length);

// Parenthesised, and doubled through `unknown` — still one allocation.
function throughParens(): readonly number[] {
    const xs = ([] as unknown) as number[];
    xs.push(1);
    xs.push(2);
    return Object.freeze(xs);
}
console.log(throughParens().join(","));

// `satisfies`, which is a no-op at run time like the others.
function throughSatisfies(): Readonly<Record<string, number>> {
    const bag = {} satisfies Record<string, number>;
    return Object.freeze(bag);
}
console.log(JSON.stringify(throughSatisfies()));

// ── The abprops shape: a keyed bag no annotation can accept ──────────────
//
// `{} as Record<Name, Entry | undefined>` is the only spelling tsc takes
// for an accumulator over a literal key union, and the loop fills it
// before the freeze publishes it.

type Name = "alpha" | "beta" | "gamma";
interface Entry {
    readonly code: number;
    readonly kind: string;
}

const SOURCE: Record<Name, Entry> = {
    alpha: { code: 1, kind: "x" },
    beta: { code: 2, kind: "y" },
    gamma: { code: 3, kind: "z" },
};

function legacyView(): Readonly<Record<Name, Entry | undefined>> {
    const view = {} as Record<Name, Entry | undefined>;
    for (const [name, entry] of Object.entries(SOURCE)) {
        view[name as Name] = Object.freeze({ code: entry.code, kind: entry.kind });
    }
    return Object.freeze(view);
}

const view = legacyView();
console.log(JSON.stringify(view));
console.log(Object.keys(view).join(","));
console.log(view.beta?.code ?? -1);
