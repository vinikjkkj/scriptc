// The AbortController/AbortSignal value surface, against Node's answers.
//
// Every line below is a question the island implementation got wrong at
// least once, or a question a naive C port gets wrong on the first try:
//
//   * a repeat addEventListener with the SAME callback is not a second
//     listener — EventTarget keys its set on (type, callback, capture),
//     so the repeat is ignored outright, the entry keeps its FIRST
//     position, the repeat's `once` is discarded, and ONE remove clears
//     it (three separate bugs in one line, all invisible to a
//     single-add test);
//   * abort() after the first abort is a NO-OP: the reason does not
//     change, and no listener fires again — which is what makes
//     abort()-after-the-operation-completed quiet rather than a late
//     rejection;
//   * `reason` keeps the OBJECT it was given, with `.code` on it. A
//     version that rebuilds the error from `.message` passes every
//     message assertion and silently drops `code`;
//   * the default reason is a DOMException named AbortError carrying the
//     WebIDL legacy code 20, not a plain Error;
//   * `once` entries leave the live list BEFORE their callback runs, so
//     a listener that re-registers itself during dispatch does not
//     re-fire in the same pass;
//   * a listener added AFTER the abort never fires;
//   * `controller.signal` is the same object on every read.

const fired: string[] = [];

// ── the empty signal ──────────────────────────────────────────────────
const c = new AbortController();
const s: AbortSignal = c.signal;
console.log("aborted", s.aborted);
console.log("reason-undefined", s.reason === undefined);

// ── registration, duplication, removal ────────────────────────────────
const a = (): void => { fired.push("a"); };
const b = (): void => { fired.push("b"); };
const gone = (): void => { fired.push("gone"); };

s.addEventListener("abort", a);
s.addEventListener("abort", b, { once: true });
s.addEventListener("abort", gone);
// The repeat: not a second registration. `a` keeps its FIRST position, so
// the order below stays a,b — not a,b,a.
s.addEventListener("abort", a, { once: true });
// One remove clears `gone`, because only one entry was ever stored for it.
s.removeEventListener("abort", gone);
// Removing something that was never added is quiet.
s.removeEventListener("abort", (): void => { fired.push("never"); });

// ── the abort, with an identity-carrying reason ───────────────────────
class Coded extends Error {
    code: string;
    constructor(message: string, code: string) {
        super(message);
        this.name = "Coded";
        this.code = code;
    }
}
const cause = new Coded("transfer timed out after 30000ms", "ERR_CUSTOM");
c.abort(cause);

console.log("order", fired.join(","));
console.log("aborted-after", s.aborted);
const r = s.reason as Coded;
console.log("reason-message", r.message);
console.log("reason-name", r.name);
// The whole point: `code` survives the round trip.
console.log("reason-code", r.code);

// ── the second abort is a no-op ───────────────────────────────────────
c.abort(new Error("this one is ignored"));
console.log("order-2", fired.join(","));
console.log("reason-message-2", (s.reason as Coded).message);
console.log("reason-code-2", (s.reason as Coded).code);

// ── a listener added after the abort never fires ──────────────────────
s.addEventListener("abort", (): void => { fired.push("late"); });
c.abort();
console.log("order-3", fired.join(","));

// ── the default reason ────────────────────────────────────────────────
const d = new AbortController();
console.log("d-before", d.signal.aborted);
d.abort();
const dr = d.signal.reason as { name: string; message: string; code: number };
console.log("default-name", dr.name);
console.log("default-message", dr.message);
console.log("default-code", dr.code);
console.log("default-is-error", d.signal.reason instanceof Error);

// ── signal identity is stable across reads ────────────────────────────
const e = new AbortController();
function abortedOf(sig: AbortSignal): boolean { return sig.aborted; }
console.log("stable-before", abortedOf(e.signal), abortedOf(e.signal));
e.abort(new Error("x"));
// If `.signal` minted a fresh object per read, this would still be false.
console.log("stable-after", abortedOf(e.signal), abortedOf(e.signal));

// ── an explicit `undefined` reason is the same as no reason ───────────
const f = new AbortController();
const noReason: Error | undefined = undefined;
f.abort(noReason);
const fr = f.signal.reason as { name: string; code: number };
console.log("undefined-reason-name", fr.name);
console.log("undefined-reason-code", fr.code);

// ── a string reason crosses as a string ───────────────────────────────
const g = new AbortController();
g.abort("why");
console.log("string-reason", g.signal.reason as string);
console.log("string-reason-type", typeof g.signal.reason);

// ── `once` removes before the call ────────────────────────────────────
// The entry is gone from the live list by the time its own callback runs,
// so a re-add inside the callback is a NEW registration that this pass
// has already snapshotted past — it does not fire until the next abort,
// and there is no next abort.
const h = new AbortController();
const reAdd = (): void => {
    fired.push("once");
    h.signal.addEventListener("abort", reAdd);
};
h.signal.addEventListener("abort", reAdd, { once: true });
h.abort();
console.log("once-order", fired.join(","));
