// `new Promise<T>((res) => res(u))` where `u` may itself be a promise:
// the executor's resolve ADOPTS it instead of throwing on it.
//
// What this compiled to before. The lib spells the executor's resolve
// `(value: T | PromiseLike<T>) => void`; the PromiseLike arm has no home of
// its own, so mapType collapsed that union to plain `T` and the promise
// possibility was gone before the call was ever lowered. The argument
// coercion then reached for the CHECKED single-arm extraction
// (narrowedArmHelper, `%union.narrow.N` in the emitted C — not
// unionRetagHelper, which shares its message string), whose promise arm is
// a throw. So
//
//     new Promise<string>((res) => { res(pick()) })
//
// compiled clean and rejected with an UNCODED
// "a 'Promise<string>' value is not representable in the target union"
// TypeError. No diagnostic code, no census trap: a silent wrong answer, and
// the worst spelling of it is section 2 below, where that internal text
// arrived at a `catch` as if it were the program's own rejection reason.
// The sibling `res(<plain promise>)` fenced LOUDLY with SC1090 instead —
// both are gaps against the ambient override's own written contract, which
// says executors "resolving with a thenable ... fail lowering on their
// types".
//
// The fix binds the resolve parameter to the SETTLE-OR-VALUE union
// `Promise<T> | T`, the one shape whose arms a runtime tag can tell apart,
// and only for executors that actually pass a promise-carrying value.
//
// ORDERING. An adopted promise settles this promise WITHOUT the microtask
// jobs JS spends on the plumbing — the same eager-settlement rule
// `Promise.race` over an already-settled entry has shipped with for a long
// time. Everything below is therefore awaited SEQUENTIALLY: this file pins
// values, locking and rejection routing, not the interleaving of
// independent chains.

function later(ms: number, v: string): Promise<string> {
    return new Promise<string>((r) => {
        setTimeout(() => {
            r(v);
        }, ms);
    });
}

// The zapo-shaped producer: a value that is sometimes already here and
// sometimes still coming.
function pick(n: number): string | Promise<string> {
    if (n === 0) {
        return "already-here";
    }
    if (n === 1) {
        return Promise.resolve("settled-promise");
    }
    return later(5, "pending-promise");
}

// ------------------------------------------- 1. both arms, and the plain
//                                                promise the sibling fence
//                                                used to refuse outright

async function adopt(n: number): Promise<string> {
    return await new Promise<string>((res) => {
        res(pick(n));
    });
}

async function adoptPlain(): Promise<string> {
    return await new Promise<string>((res) => {
        res(later(1, "plain-promise"));
    });
}

// -------------------------------------- 2. RESOLVE LOCKS. Resolving with a
//    still-pending promise fixes the outcome: a later resolve(), a later
//    reject() and a throw escaping the executor are all no-ops, exactly as
//    in JS. This is the case a naive adoption gets wrong — it is why the
//    executor is handed its own settle capability whose settled state is
//    the spec's `alreadyResolved` flag, rather than the result promise.

async function locked(): Promise<string> {
    const p = new Promise<string>((res, rej) => {
        res(pick(2));
        res("second-resolve-must-be-ignored");
        rej(new Error("reject-after-resolve-must-be-ignored"));
        throw new Error("throw-after-resolve-must-be-swallowed");
    });
    try {
        return await p;
    } catch (e) {
        return `WRONG: ${(e as Error).message}`;
    }
}

// ------------------------- 3. a REJECTION on the adopted promise reaches
//                              the caller as a rejection, once, and the
//                              inner promise counts as handled (no
//                              "unhandled promise rejection" report)

function rejecting(): Promise<string> {
    return new Promise<string>((_r, rj) => {
        rj(new Error("inner-boom"));
    });
}

function maybeRejecting(n: number): string | Promise<string> {
    return n > 0 ? rejecting() : "no-boom";
}

async function adoptedRejection(): Promise<string> {
    try {
        return await new Promise<string>((res) => {
            res(maybeRejecting(1));
        });
    } catch (e) {
        return `caught ${(e as Error).message}`;
    }
}

// ------------------------------ 4. the executor's OWN reject and its own
//                                   escaping throw still win when they run
//                                   first — adoption must not disturb them

async function rejectFirst(): Promise<string> {
    const p = new Promise<string>((res, rej) => {
        rej(new Error("reject-first"));
        res(pick(1));
    });
    try {
        return await p;
    } catch (e) {
        return `caught ${(e as Error).message}`;
    }
}

async function throwFirst(): Promise<string> {
    const p = new Promise<string>((res) => {
        if (pick(0) === "") {
            res(pick(1));
        }
        throw new Error("executor-threw");
    });
    try {
        return await p;
    } catch (e) {
        return `caught ${(e as Error).message}`;
    }
}

// --------------------- 5. an executor that resolves with a PLAIN value in
//                          one branch and a promise in the other: the same
//                          resolve closure, both arms, one program

async function eitherWay(n: number): Promise<string> {
    return await new Promise<string>((res) => {
        if (n === 7) {
            res("plain-branch");
        } else {
            res(pick(1));
        }
    });
}

async function main(): Promise<void> {
    console.log("arm-value  ", await adopt(0));
    console.log("arm-settled", await adopt(1));
    console.log("arm-pending", await adopt(2));
    console.log("plain      ", await adoptPlain());
    console.log("locked     ", await locked());
    console.log("rejection  ", await adoptedRejection());
    console.log("reject1st  ", await rejectFirst());
    console.log("throw1st   ", await throwFirst());
    console.log("either A   ", await eitherWay(7));
    console.log("either B   ", await eitherWay(8));
}

void main();
