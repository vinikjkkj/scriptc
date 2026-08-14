// A COMPUTED spread source evaluates once even when a property is written
// before it — as long as that property's value cannot change across the
// call.
//
// The field-by-field spread desugar copies a source field by field, so a
// source that is a CALL has to be evaluated once into a hidden slot and
// read from there. That hoist fills the slot in the prelude, ahead of
// every field, which moves the call ahead of any earlier contributor — so
// it was withheld whenever ANY explicit property came first, and the
// computed-source fence took over ("bind it to a const first").
//
// The swap is only observable for a contributor whose VALUE the call could
// change. A read of an IMMUTABLE local cannot be one: nothing a callee
// does can reassign a `const` binding of the caller. Literals likewise.
// `{ filePath, ...meter.finalize() }` is zapo's `client/media.ts:181`, and
// the fence was telling the author to bind a const the desugar can bind
// for itself.
//
// What still fences is the point of the rule and is exercised below
// through the spellings that DO compile: an earlier contributor that is a
// field read, or a `let` a closure can reassign, is order-dependent, and
// those keep the fence on `82d8eb2` and on this branch alike.

let calls = 0;

interface Digest {
    readonly sha: string;
    readonly size: number;
}

function makeMeter(): { finalize: () => Digest } {
    return {
        finalize(): Digest {
            calls += 1;
            return { sha: `sha-${String(calls)}`, size: 100 * calls };
        },
    };
}

// ----------------------------------------- 1. zapo's media prepare shape

function prepare(tag: string): { filePath: string; sha: string; size: number } {
    const filePath = `/tmp/zapo-media-${tag}`;
    const meter = makeMeter();
    return { filePath, ...meter.finalize() };
}

const a = prepare("a");
console.log(a.filePath, a.sha, a.size);
console.log("keys", Object.keys(a).join(","));
console.log("json", JSON.stringify(a));
console.log("calls", calls);

const b = prepare("b");
console.log(b.filePath, b.sha, b.size);
console.log("calls", calls);

// ------------------------------- 2. the source is called EXACTLY once...

function once(): { k: number; sha: string; size: number } {
    const k = 5;
    const m = makeMeter();
    // Two fields copied out of ONE call: `calls` must move by exactly one.
    return { k, ...m.finalize() };
}
const before = calls;
const o = once();
console.log("once", o.k, o.sha, o.size, "delta", calls - before);

// ---------------------- 3. ...and the earlier literal keeps its position

function litFirst(): { z: number; sha: string; size: number } {
    const m = makeMeter();
    return { z: 0, ...m.finalize() };
}
const l = litFirst();
console.log("litFirst", Object.keys(l).join(","), JSON.stringify(l));

// ------------- 4. an earlier const whose value the call CANNOT change,
//                  where the call is observably effectful

const log: string[] = [];
function effect(name: string): { e: string } {
    log.push(name);
    return { e: name };
}
function stableFirst(): { n: string; e: string } {
    const n = "kept";
    log.push("before");
    return { n, ...effect("call") };
}
const s = stableFirst();
console.log("stableFirst", s.n, s.e, "log", log.join("|"));

// ------------------------------------ 5. spread FIRST is unchanged, and
//                                         a later property still overrides

function spreadFirst(): { sha: string; size: number } {
    const m = makeMeter();
    return { ...m.finalize(), size: 7 };
}
const sf = spreadFirst();
console.log("spreadFirst", Object.keys(sf).join(","), JSON.stringify(sf));

// ------------------------------------ 6. two computed sources, in order

function twoSources(): { sha: string; size: number; e: string } {
    const m = makeMeter();
    const tag = "two";
    return { ...m.finalize(), ...effect(tag) };
}
const t = twoSources();
console.log("twoSources", JSON.stringify(t), "log", log.join("|"));

console.log("total-calls", calls);
console.log("done");
