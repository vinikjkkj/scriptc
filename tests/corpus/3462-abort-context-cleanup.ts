// The cancel-context idiom, exactly as real code writes it: an OPTIONAL
// external signal, a listener closure that captures both the controller
// and the signal it is registered on, `{ once: true }`, and a cleanup
// that removes by identity.
//
// This is the shape that makes the AbortSignal family impossible to slice.
// Three of the operations it uses — `reason`, `addEventListener`,
// `removeEventListener` — sit inside branches whose CONDITIONS are the
// other four. `if (externalSignal.aborted)` gates the registration;
// `signal: controller.signal` gates the cleanup closure. Fence the first
// four and the last three are unreachable, so a trap census cannot see
// them at all. Lower only what the census shows and the census gets
// WORSE: the three surface as new refusals.
//
// The four paths below are the four a cancel context actually takes, and
// each has a different failure mode:
//
//   * no external signal      — the null branch must not register anything
//   * external aborts LATER   — the listener propagates the reason across,
//                               the object itself, not a copy of its text
//   * external ALREADY aborted— the listener never registers; the reason
//                               crosses through the direct call instead
//   * cleanup BEFORE the abort— the removed listener must not fire, which
//                               is the difference between a remove that
//                               releases and a remove that forgets

interface Ctx {
    readonly signal: AbortSignal;
    cleanup(): void;
}

function createAbortContext(externalSignal: AbortSignal | undefined): Ctx {
    const controller = new AbortController();
    let onExternalAbort: (() => void) | null = null;
    if (externalSignal) {
        onExternalAbort = (): void => controller.abort(externalSignal.reason);
        if (externalSignal.aborted) {
            onExternalAbort();
        } else {
            externalSignal.addEventListener("abort", onExternalAbort, { once: true });
        }
    }
    return {
        signal: controller.signal,
        cleanup: (): void => {
            if (externalSignal && onExternalAbort) {
                externalSignal.removeEventListener("abort", onExternalAbort);
            }
        },
    };
}

// 1. No external signal at all.
const a = createAbortContext(undefined);
console.log("a", a.signal.aborted);
a.cleanup();
console.log("a-after-cleanup", a.signal.aborted);

// 2. An external signal that aborts LATER.
const outer = new AbortController();
const b = createAbortContext(outer.signal);
console.log("b-before", b.signal.aborted);
outer.abort(new Error("outer went away"));
console.log("b-after", b.signal.aborted);
console.log("b-reason", (b.signal.reason as Error).message);
b.cleanup();

// 3. An external signal ALREADY aborted: the listener never registers,
//    and the reason crosses through the direct call.
const pre = new AbortController();
pre.abort(new Error("already"));
const c = createAbortContext(pre.signal);
console.log("c", c.signal.aborted, (c.signal.reason as Error).message);
c.cleanup();

// 4. cleanup() BEFORE the abort: the removed listener must not fire.
const late = new AbortController();
const d = createAbortContext(late.signal);
d.cleanup();
late.abort(new Error("too late"));
console.log("d", d.signal.aborted);
console.log("d-reason-undefined", d.signal.reason === undefined);
// And cleanup() twice is quiet.
d.cleanup();
console.log("d-twice", d.signal.aborted);

// 5. Two contexts over ONE external signal: both listeners fire, in
//    registration order, and each carries the same reason object.
const shared = new AbortController();
const e1 = createAbortContext(shared.signal);
const e2 = createAbortContext(shared.signal);
shared.abort(new Error("fan out"));
console.log("e", e1.signal.aborted, e2.signal.aborted);
console.log("e-reasons", (e1.signal.reason as Error).message, (e2.signal.reason as Error).message);
e1.cleanup();
e2.cleanup();
