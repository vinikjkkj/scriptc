// `p?.then(...)` / `p?.catch(...)` / `p?.finally(...)` — a promise method
// called through an optional chain.
//
// The promise lowering declined the chain's RE-DISPATCH. lowerOptionalChain
// evaluates the guarded receiver, proves it non-nullish, binds it to a
// chainRecv and asks for the plain lowering of the same node — the `?.`
// token is still on the syntax, and a raw `questionDotToken` test read it
// and said no. The site then fell through to the standard-library member
// fence and reported SC2020 naming `.catch`, as though `.catch` were the
// unsupported thing. `chainBlocked` is the idiom that distinguishes the two
// ("every receiver-typed lowering that supports chained receivers guards
// with this instead of a raw questionDotToken check"), and it is what the
// twenty-four lowerings that already ride chained receivers use.
//
// The second half of the change is the result TYPE. Under the chain the
// checker types the call node as the whole chain's `Promise<T> | undefined`
// — that undefined is the GUARD's, not this call's — and the chain wraps
// the body into exactly that union itself. So the lowering asks for the
// non-nullable type and hands the chain the promise it is waiting for.
//
// zapo's spelling is `client/messaging/group-metadata.ts:197` —
// `await pendingMutations.get(groupJid)?.catch(() => undefined)`, a map of
// in-flight writes: await the one running for this jid, if one is.

const pending = new Map<string, Promise<void>>();

async function settleFor(jid: string): Promise<string> {
    // The zapo spelling verbatim.
    await pending.get(jid)?.catch(() => undefined);
    return `done:${jid}`;
}

pending.set("ok", Promise.resolve());
pending.set("bad", Promise.reject(new Error("write failed")));

// A present, FULFILLING entry: the handler never runs.
console.log(await settleFor("ok"));
// A present, REJECTING entry: the handler swallows it, the await completes.
console.log(await settleFor("bad"));
// An ABSENT entry: the chain short-circuits, nothing is awaited.
console.log(await settleFor("missing"));

// The VALUE of the chain, not just its effect. Present-and-rejecting gives
// the handler's return; absent gives undefined.
// A helper so tsc keeps the `| undefined` on the binding: a `const x:
// Promise<T> | undefined = undefined` narrows all the way to `never`'s
// member set and the chain never gets to run.
function maybe<T>(present: boolean, v: T): Promise<T> | undefined {
    return present ? Promise.resolve(v) : undefined;
}

async function failNum(msg: string): Promise<number> {
    throw new Error(msg);
}
const rejecting: Promise<number> | undefined = failNum("nope");
console.log(await rejecting?.catch(() => -1));
const absent = maybe<number>(false, 0);
console.log(await absent?.catch(() => -1));

// `.then` through the chain, both present and absent.
const some: Promise<number> | undefined = Promise.resolve(7);
console.log(await some?.then((n) => n * 3));
const none = maybe<number>(false, 0);
console.log(await none?.then((n: number) => n * 3));

// `.finally` through the chain: the callback runs for a present receiver
// and the settled value passes through unchanged.
let finallyRuns = 0;
const fin: Promise<string> | undefined = Promise.resolve("kept");
console.log(await fin?.finally(() => { finallyRuns += 1; }), finallyRuns);
const finAbsent = maybe<string>(false, "");
console.log(await finAbsent?.finally(() => { finallyRuns += 1; }), finallyRuns);

// The handler-less passthrough spelling through a chain.
const pass: Promise<number> | undefined = Promise.resolve(5);
console.log(await pass?.catch());

// The RECEIVER is evaluated exactly once, and only when the chain is taken.
let reads = 0;
function lookup(k: string): Promise<number> | undefined {
    reads += 1;
    return k === "hit" ? Promise.resolve(1) : undefined;
}
console.log(await lookup("hit")?.then((n) => n + 100), reads);
console.log(await lookup("miss")?.then((n) => n + 100), reads);

// A rejection the handler RE-THROWS still propagates out of the chain.
const boom: Promise<number> | undefined = failNum("first");
try {
    await boom?.catch((e) => { throw new Error(`wrapped:${(e as Error).message}`); });
    console.log("unreachable");
} catch (e) {
    console.log((e as Error).message);
}

// The UNCHAINED spellings, unchanged: this rule must not have moved them.
console.log(await Promise.resolve(11).then((n) => n + 1));
async function failStr(): Promise<string> {
    throw new Error("plain");
}
console.log(await failStr().catch(() => "caught"));

export {};
