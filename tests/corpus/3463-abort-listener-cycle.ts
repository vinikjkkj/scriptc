// The signal <-> listener cycle, left ALIVE at exit.
//
// A listener is a RETAINED closure, so the moment ordinary code writes
//
//     const onAbort = () => controller.abort(signal.reason)
//     signal.addEventListener('abort', onAbort, { once: true })
//
// there is a reference cycle: signal -> closure -> signal (and one hop
// longer, closure -> controller -> signal, when the captured name is the
// controller). Refcounting alone can never reclaim that, and until this
// surface existed the IR asserted the opposite — "no cycles reachable
// from it (the abort reason is the only payload)".
//
// So both handles are collector-headered and the listener vector is a
// TRACED edge. This file is the proof that the edge is load-bearing
// rather than decorative: with the trace emptied out, the same program
// leaks ten signals, ten controllers, ten closures and twenty boxes under
// SCRIPTC_RC_AUDIT=1 and exits 99. With it, the audit is clean.
//
// The cycles are never aborted and never removed on purpose — a fired
// `once` listener would unregister itself and break the cycle before the
// collector ever had to see it, which is exactly the way to write a test
// that proves nothing.

function signalCaptured(tag: string): void {
    const c = new AbortController();
    const s = c.signal;
    let seen = 0;
    const onAbort = (): void => {
        // captures the signal it is registered on, AND the controller
        seen += s.aborted ? 1 : 0;
        c.abort();
    };
    s.addEventListener("abort", onAbort);
    console.log(tag, s.aborted, seen);
}

function controllerCaptured(tag: string): void {
    const c = new AbortController();
    // closure -> controller -> signal -> closure: the same loop, one hop
    // longer, and it needs the CONTROLLER's edge traced as well.
    const onAbort = (): void => { c.abort(); };
    c.signal.addEventListener("abort", onAbort, { once: true });
    console.log(tag, c.signal.aborted);
}

for (let i = 0; i < 5; i++) signalCaptured("sig" + String(i));
for (let i = 0; i < 5; i++) controllerCaptured("ctl" + String(i));

// A cycle that ALSO holds a reason: the reason is deliberately untraced
// (no ScrDyn tracing exists in this runtime), so this one is reclaimed
// through the listener edge, not through the payload.
function abortedCycle(tag: string): void {
    const c = new AbortController();
    const s = c.signal;
    const onAbort = (): void => { console.log(tag, "fired", s.aborted); };
    s.addEventListener("abort", onAbort);
    c.abort(new Error("held by the signal " + tag));
    console.log(tag, (s.reason as Error).message);
}
for (let i = 0; i < 3; i++) abortedCycle("hold" + String(i));

console.log("done");
