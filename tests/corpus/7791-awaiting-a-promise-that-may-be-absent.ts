// `await` over a `Promise<T> | undefined` whose PAYLOAD is the
// checked-dynamic value or a union -- the two shapes `awaitUnionExpr`
// could not carry.
//
// That node's result must be `void` or a union (the validator and both
// emitters agree), and neither of those is the checker's answer here: an
// `unknown` payload awaits to the dyn, a union payload awaits to a
// re-tagged union whose arms the node has no shape for. So the refusal
// was about the NODE, never about the semantics -- and zapo-js 1.8.2
// writes the first shape at `client/coordinators/WaPrivacyCoordinator.ts:383`,
// `await activeRefresh?.catch(() => undefined)` over a
// `Promise<unknown> | null`, to join a refresh already in flight.
//
// The lowering writes the semantics out instead: the operand lands in a
// temp, the union's own TAG picks the branch, the promise arm parks on a
// real await and the unit arm takes `async.hop` -- JS's one microtask turn
// for awaiting a non-thenable, which is the identical accounting the
// emitter's own awaitUnionExpr performs and the same libCall the bare-unit
// await already uses. It rides a TERNARY rather than an if-statement
// because that is the one expression form both emitters already expand
// into branches.
//
// What this pins against Node: both arms of a dyn payload and of a union
// payload; the MICROTASK accounting on each arm separately (three ticks
// queued after the await must run after the resumption, not before); a
// rejection crossing the promise arm; and the join-an-in-flight-refresh
// shape the coordinator uses.
//
// READ THIS BEFORE YOU MEASURE TICKS OVER A PROMISE, WHOEVER YOU ARE.
// A `Promise<number>` flowing into a `Promise<unknown>` slot does NOT
// arrive as itself: the payload has to widen, so the value rides
// `promiseCoerceAdapter` -- a lifted async helper that awaits the source
// and re-fulfils. That adapter's own turn count DIVERGES from Node, and it
// is pre-existing and independent of anything here. Measured on this box:
// `ticks("...", Promise.resolve(1))` against a `Promise<unknown>`
// parameter reads `t1|t2|t3|awaited` where Node reads
// `awaited|t1|t2|t3` -- while the identical call with a function that
// RETURNS `Promise<unknown>` reads `awaited|t1|t2|t3` on both sides.
//
// So a tick measurement taken over a WIDENED promise is measuring the
// adapter, not the construct under test. It cost most of a false
// regression against this very lowering before the two were separated,
// which is why `makeUnknown` below returns the wide type directly instead
// of letting the call site coerce. If you are here to weigh microtasks,
// check what the argument's static type is at the CALL before you believe
// the ledger.

type Row = { readonly k: "a"; readonly n: number } | { readonly k: "b"; readonly s: string };

const log: string[] = [];

async function work(tag: string, ms: number, fail: boolean): Promise<string> {
    await new Promise<void>((r) => {
        setTimeout(() => r(), ms);
    });
    if (fail) throw new Error(tag + "-failed");
    log.push("done " + tag);
    return tag;
}

// The coordinator's shape: an in-flight refresh that may be absent, joined
// before issuing a new read. `?.` supplies the undefined arm; the `.catch`
// keeps a rejected in-flight refresh from becoming this caller's problem.
let activeRefresh: Promise<unknown> | null = null;

async function followUpRefresh(): Promise<void> {
    await activeRefresh?.catch(() => undefined);
    log.push("after");
}

// A UNION payload beside the unit arm: each arm re-tags into the checker's
// own result union.
async function readRow(p: Promise<Row> | undefined): Promise<string> {
    const r = await p;
    if (r === undefined) return "absent";
    return r.k === "a" ? "a" + r.n : "b" + r.s;
}

// The dyn payload, without an incidental payload CONVERSION at the call
// site: `Promise<number>` flowing into a `Promise<unknown>` slot rides a
// coercion adapter whose own turn count is a separate question, and
// measuring it here would measure that instead of this.
async function makeUnknown(v: number): Promise<unknown> {
    return v;
}

// The tick ledger, per arm. Three continuations are queued AFTER the await
// starts; the awaiting function must resume before all of them.
async function ticks(label: string, p: Promise<unknown> | undefined): Promise<void> {
    const seq: string[] = [];
    const pending = (async (): Promise<void> => {
        await p;
        seq.push("awaited");
    })();
    void Promise.resolve().then(() => {
        seq.push("t1");
    });
    void Promise.resolve().then(() => {
        seq.push("t2");
    });
    void Promise.resolve().then(() => {
        seq.push("t3");
    });
    await pending;
    console.log(label, seq.join("|"));
}

async function main(): Promise<void> {
    // Nothing in flight: the unit arm, one hop, no work performed.
    await followUpRefresh();
    console.log(log.join(","));

    // One in flight: the promise arm parks on it, so its work lands FIRST.
    activeRefresh = work("r1", 5, false);
    await followUpRefresh();
    console.log(log.join(","));

    // One in flight that REJECTS: the `.catch` swallows it and the join
    // still completes.
    activeRefresh = work("r2", 3, true);
    await followUpRefresh();
    console.log(log.join(","));

    console.log(await readRow(undefined));
    console.log(await readRow(Promise.resolve({ k: "a", n: 7 } as Row)));
    console.log(await readRow(Promise.resolve({ k: "b", s: "z" } as Row)));

    await ticks("unit ", undefined);
    await ticks("promise", makeUnknown(1));

    // A rejection reaching the await through the promise arm.
    try {
        const p: Promise<unknown> | undefined = work("r3", 1, true);
        await p;
        console.log("unreachable");
    } catch (e) {
        console.log("threw", e instanceof Error ? e.message : "?");
    }
}

void main();

export {};
