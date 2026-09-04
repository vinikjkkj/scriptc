// A promise seen through `unknown` publishes `then`. The READ and the CALL
// have to agree: scr_dyn_invoke has run then/catch/finally on a PROMISE
// receiver for a long time, while the read's table (dyn_kind_knows) left
// PROMISE in its `default: return false` arm — so `typeof v.then` answered
// `undefined` while `v.then(f)` settled the promise, at exit 0 with no
// diagnostic. That is the thenable feature-detect every library writes,
// and the reason `PromiseLike<T>` exists in the first place.
//
// The names are the ones the call arm implements. Everything else on
// Promise.prototype is `then`-adjacent sugar JS does not have either, so
// `undefined` there IS the JS answer and this program pins that too.

const v: unknown = Promise.resolve(9);

console.log(typeof v);
console.log("then", typeof (v as { readonly then?: unknown }).then);
console.log("catch", typeof (v as { readonly catch?: unknown }).catch);
console.log("finally", typeof (v as { readonly finally?: unknown }).finally);
console.log("hasOwnProperty", typeof (v as { readonly hasOwnProperty?: unknown }).hasOwnProperty);
console.log("nope", typeof (v as { readonly nope?: unknown }).nope);

// `in` walks the prototype chain, so a name the read answers must be a
// name `in` reports.
console.log("in then", "then" in (v as object));
console.log("in nope", "nope" in (v as object));

// A plain object with a non-callable `then` is not a thenable; the guard
// below is the one every such library writes, so both answers matter.
function isThenable(value: unknown): boolean {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

console.log("guard promise", isThenable(v));
console.log("guard plain", isThenable({ then: 1 }));
console.log("guard null", isThenable(null));
console.log("guard number", isThenable(7));

// The extracted member is a callable value, not a hole. Calling it THROUGH
// the extraction is not tested here on purpose: Node's `p.then` is unbound,
// so `const f = p.then; f(cb)` throws there and this runtime binds — a
// divergence scr_dyn_invoke's own header records, and one this program has
// no business re-deciding. The call arm itself is pinned on the typed
// spelling by 2679-then-two-handlers.ts.
const extracted = (v as { readonly then?: unknown }).then;
console.log("extracted", typeof extracted);
