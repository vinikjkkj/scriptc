// The two fences the retagged `??` keeps, stated so the next block finds
// them written down rather than rediscovers them.

// 1. A PROMISE arm in the result union. `provided ?? gen()` inside an
//    async function types `Promise<string> | string`, and `T | Promise<T>`
//    does not survive a union re-tag anywhere in this compiler: four lines
//    with no `??` in them throw an UNCODED "not representable in the
//    target union" TypeError. Admitting it here would retire this SC1090
//    and hand the same program a runtime throw with no diagnostic code.
async function resolveStanzaId(provided: string | undefined, gen: () => Promise<string>): Promise<string> {
    return provided ?? gen();
}

// 2. The result type is a single RECORD, not a union — a contextually
//    typed `{}` default at a call argument, over a left with TWO non-unit
//    arms. There is no arm to re-tag INTO; this wants a union-to-arm
//    narrowing, which is a different question from widening.
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
void resolveStanzaId;
