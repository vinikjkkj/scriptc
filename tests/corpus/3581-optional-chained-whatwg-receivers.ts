// `u?.toString()` and the URLSearchParams list surface through an optional
// chain — the receiver-typed lowerings' half of the `chainBlocked` root.
//
// `lowerOptionalChain` evaluates the guarded receiver, proves it non-nullish,
// binds it to a chainRecv and RE-DISPATCHES the plain lowering of the same
// node. The `?.` token is still on the syntax at that point, so a raw
// `questionDotToken` test in the receiver-typed lowering read it and declined
// its own chain's re-dispatch. The site then fell out of the URL /
// URLSearchParams paths entirely and landed on the generic standard-library
// member fence, which named the MEMBER (`'URL.toString' is typed by
// @types/node but has no scriptc lowering yet`) though the only unsupported
// thing about the site was the `?.`.
//
// What has to hold, and is asserted here rather than described:
//  - the present receiver produces the member's real answer;
//  - the absent receiver produces `undefined` and the member never runs;
//  - the chain SHORT-CIRCUITS its arguments — a nullish receiver must not
//    evaluate what `?.` skips (a guard that stops declining must not start
//    evaluating);
//  - the receiver is evaluated exactly ONCE per chain;
//  - mutation through a chained call is a real mutation on the real object.

function pickUrl(on: boolean): URL | undefined {
    return on ? new URL("https://example.com/a/b?x=1&y=2#frag") : undefined;
}

// The receiver expression counts its own evaluations: the chain must
// evaluate it once, and only the arguments of a TAKEN chain may run.
let recvEvals = 0;
function countedUrl(on: boolean): URL | undefined {
    recvEvals = recvEvals + 1;
    return pickUrl(on);
}

console.log("present href:", String(pickUrl(true)?.toString()));
console.log("absent  href:", String(pickUrl(false)?.toString()));
console.log("absent is undefined:", pickUrl(false)?.toString() === undefined);

console.log("recv evals before:", recvEvals);
const taken = countedUrl(true)?.toString();
const skipped = countedUrl(false)?.toString();
console.log("recv evals after:", recvEvals);
console.log("taken:", String(taken), "skipped:", String(skipped));

// ── URLSearchParams: the WHATWG list surface, chained ──────────────────
function pickParams(on: boolean): URLSearchParams | undefined {
    return on ? new URLSearchParams("a=1&b=2&a=3") : undefined;
}

const present = pickParams(true);
const absent = pickParams(false);

console.log("get a:", String(present?.get("a")));
console.log("get z:", String(present?.get("z")));
console.log("getAll a:", String(present?.getAll("a").join("|")));
console.log("has b:", String(present?.has("b")), String(absent?.has("b")));
console.log("size:", String(present?.size), String(absent?.size));

// The ARGUMENT short-circuit: `key()` must run for the taken chain and NOT
// for the skipped one. This is the property a converted guard could most
// plausibly break — it stops declining, and the chain body it now lowers
// has to stay inside the guard.
let keyEvals = 0;
function key(): string {
    keyEvals = keyEvals + 1;
    return "a";
}
console.log("taken arg:", String(present?.get(key())));
console.log("key evals:", keyEvals);
console.log("skipped arg:", String(absent?.get(key())));
console.log("key evals:", keyEvals);

// A chained call that MUTATES: the append lands on the real object, which
// the next chained read observes.
present?.append("c", "4");
console.log("after append:", String(present?.toString()));
absent?.append("c", "4");
console.log("absent append is a no-op:", absent === undefined);

// Statement position, void result: `delete` through a chain.
present?.delete("a");
console.log("after delete:", String(present?.toString()));
console.log("get a now:", String(present?.get("a")));
