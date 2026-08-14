// Two property lowerings whose raw `questionDotToken` test declined the
// optional-chain re-dispatch: the shared-field read on a UNION receiver
// (lowerUnionProperty — the discriminant and shared-payload patterns) and
// the tail of lowerFieldRead, whose guard sits below the ordinary field
// read and so gated only the FOLDS and the named fences beneath it.
//
// The tuple `.length` fold is the dangerous one in this pair. It answers a
// compile-time CONSTANT and discards the receiver entirely, so a chain
// whose guard went missing would answer the arity for an absent receiver
// instead of undefined — a wrong value, silently, with no trap. Both
// arms are pinned.

type Ok = { kind: "ok"; n: number; tag: string };
type Err = { kind: "err"; message: string; tag: string };
type Res = Ok | Err;

// A union receiver the checker cannot narrow at the read: `u?.kind` is the
// discriminant pattern, `u?.tag` the shared-payload one. Neither arm is
// nullish, so the guard folds away and the read is the plain unionDisc.
function describe(u: Res): string {
    return u?.kind;
}
function tagOf(u: Res): string {
    return u?.tag;
}

const ok: Res = { kind: "ok", n: 5, tag: "first" };
const err: Res = { kind: "err", message: "boom", tag: "second" };

console.log("kind:", describe(ok), describe(err));
console.log("tag:", tagOf(ok), tagOf(err));
console.log("agrees with plain:", describe(ok) === ok.kind, tagOf(err) === err.tag);

// The discriminant read composes with the comparisons and switches built
// on it — the whole point of the unionDisc node.
function label(u: Res): string {
    if (u?.kind === "ok") return "an ok";
    switch (u?.kind) {
        case "err":
            return "an err";
        default:
            return "neither";
    }
}
console.log("label:", label(ok), label(err));

// A union receiver evaluated through a CALL: the receiver runs exactly
// once even though the read discards nothing.
let recvEvals = 0;
function source(which: boolean): Res {
    recvEvals = recvEvals + 1;
    return which ? ok : err;
}
console.log("call kind:", source(true)?.kind, source(false)?.kind);
console.log("receiver evals:", recvEvals);

// ── the tuple `.length` fold ───────────────────────────────────────────
const trip: [number, string, boolean] = [1, "a", true];
console.log("tuple length:", trip?.length);
console.log("agrees with plain:", trip?.length === trip.length);

let tupEvals = 0;
function tuple(on: boolean): [number, string, boolean] | undefined {
    tupEvals = tupEvals + 1;
    return on ? trip : undefined;
}

// The fold discards the receiver, so an absent one MUST still answer
// undefined rather than the arity. This is the guard, and nothing else.
const present = tuple(true);
console.log("present length:", present?.length);
const absent = tuple(false);
console.log("absent length:", absent?.length);
console.log("absent is undefined:", absent?.length === undefined);
console.log("not the arity:", absent?.length !== 3);
console.log("tuple evals:", tupEvals);

// An ordinary record field read through the same guard, so the fold and
// the plain path are shown side by side.
type Point = { x: number; y: number };
function point(on: boolean): Point | undefined {
    return on ? { x: 2, y: 3 } : undefined;
}
console.log("field:", point(true)?.x, point(true)?.y);
console.log("absent field:", point(false)?.x);

// Index-signature reads keep their own path under the guard.
const bag: Record<string, number> = { a: 1, b: 2 };
console.log("bag:", bag?.a, bag?.b);
