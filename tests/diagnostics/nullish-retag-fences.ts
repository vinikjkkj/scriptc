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

// It used to pin a THIRD one, and that one is retired too. This file's
// spelling was `take((t as Opts | undefined) ?? {})` — a cast to a strict
// SUB-UNION, which the lowering ERASED, so `??` was handed the operand's
// whole union and reported the sub-union fence over four arms where the
// assertion named two. The cast is honoured now (the same
// narrowedRetagHelper bridge coerceToExpected already ran at the SLOT), so
// that shape compiles and answers correctly on both backends —
// `tests/corpus/4282-an-as-cast-to-a-sub-union-is-honoured.ts` is that
// exact site, byte-identical to Node, and zapo's is
// `WaMessageCoordinator.ts:421`.
//
// What REMAINS is the same shape at the BOUNDARY of the new rule, and it
// is worth pinning precisely there. The assertion below narrows in tsc's
// eyes — every arm of the operand that survives is assignable to `Narrow` —
// but `Narrow` is not an IDENTICAL arm of the operand's lowered union
// (`Opts` declares `from` and `Narrow` does not), so there is no arm-wise
// re-tag to build: narrowedRetagHelper declines, the cast keeps its
// erasure, and `??` is handed the operand's three arms exactly as before.
// A left with TWO non-unit arms whose result type is a single RECORD has
// no arm to re-tag INTO; that wants a union-to-arm narrowing, which is a
// different question from widening.
interface Opts {
    readonly tag?: string;
    readonly from?: string;
}
interface Narrow {
    readonly tag?: string;
}
function take(o: Opts): string {
    return o.tag ?? "none";
}
function forward(t: string[] | Opts | undefined): string {
    return take((t as Narrow | undefined) ?? {});
}

console.log(forward(undefined));
