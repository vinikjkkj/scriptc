// Dispatch order under mutation, and re-entrancy.
//
// The 'abort' pass runs over a SNAPSHOT of the listener list, which is
// how an add during dispatch stays out of the pass it was made in. A
// snapshot alone gets the other half wrong: a listener REMOVED by an
// earlier listener in the same pass must not fire either, and a plain
// copy runs it anyway. Measured against Node v25.9.0 — `later` below does
// not appear. Both halves are invisible to any test with one listener.
//
// Re-entrancy is the third question: `abort()` from inside a listener of
// the same signal is a no-op, because the signal is already aborted by
// the time any listener runs. If it were not, the dispatch would recurse.

const log: string[] = [];

// ── a listener removed mid-dispatch does not fire ─────────────────────
const a = new AbortController();
const later = (): void => { log.push("later"); };
a.signal.addEventListener("abort", (): void => {
    log.push("first");
    a.signal.removeEventListener("abort", later);
});
a.signal.addEventListener("abort", later);
a.signal.addEventListener("abort", (): void => { log.push("third"); });
a.abort();
console.log("removed-mid-dispatch", log.join(","));

// ── a listener added mid-dispatch does not fire in that pass ──────────
const b = new AbortController();
b.signal.addEventListener("abort", (): void => {
    log.push("b1");
    b.signal.addEventListener("abort", (): void => { log.push("b-added"); });
});
b.signal.addEventListener("abort", (): void => { log.push("b2"); });
b.abort();
console.log("added-mid-dispatch", log.join(","));

// ── re-entrancy: abort() inside a listener is a no-op ─────────────────
const c = new AbortController();
let depth = 0;
c.signal.addEventListener("abort", (): void => {
    depth += 1;
    c.abort(new Error("re-entrant"));
    log.push("c" + String(depth));
});
c.abort(new Error("first"));
console.log("depth", depth);
console.log("c-reason", (c.signal.reason as Error).message);
console.log("c-log", log.join(","));

// ── `once` and non-once mixed, with a remove of the once entry ────────
const d = new AbortController();
const onceOne = (): void => { log.push("once1"); };
d.signal.addEventListener("abort", onceOne, { once: true });
d.signal.addEventListener("abort", (): void => { log.push("plain"); });
d.signal.removeEventListener("abort", onceOne);
d.abort();
console.log("mixed", log.join(","));

// ── a signal with no listeners at all aborts quietly ──────────────────
const e = new AbortController();
e.abort(new Error("nobody listening"));
console.log("quiet", e.signal.aborted, (e.signal.reason as Error).message);
