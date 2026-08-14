// The fence the retagged `??` keeps, stated so the next block finds it
// written down rather than rediscovers it.
//
// This file used to pin a SECOND one: a PROMISE arm in the result union,
// which `provided ?? gen()` inside an async function produces. That fence
// is RETIRED — it was never a fact about `??`. The union mapped; what
// mishandled it was the async RETURN, which tested for a value whose whole
// type was `promise` and let a union carrying a promise arm fall through
// to a checked single-arm extraction that throws. Routing the return
// through settleOrValueAwait fixed the consumer, and the shape now
// compiles and answers correctly on both backends —
// `tests/corpus/3522-a-nullish-default-may-settle.ts` is that exact site,
// byte-identical to Node.

// The result type is a single RECORD, not a union — a contextually typed
// `{}` default at a call argument, over a left with TWO non-unit arms.
// There is no arm to re-tag INTO; this wants a union-to-arm narrowing,
// which is a different question from widening.
interface Opts {
    readonly tag?: string;
    readonly from?: string;
}
function take(o: Opts): string {
    return o.tag ?? "none";
}
function forward(t: string[] | Opts | undefined): string {
    return take((t as Opts | undefined) ?? {});
}

console.log(forward(undefined));
