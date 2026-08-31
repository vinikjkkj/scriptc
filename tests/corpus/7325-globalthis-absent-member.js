// The JavaScript half of 7324. A stdlib global taken as a VALUE in a JS
// source becomes an interned identity token; for a global this host does
// NOT have there is no object to name, so the token would be a lie —
// `typeof globalThis.gc` printed "string" and `globalThis.gc === undefined`
// printed false, at exit 0, where Node prints "undefined" and true.
console.log(typeof globalThis.gc);
console.log(globalThis.gc === undefined);
// (`globalThis.window` is NOT here on purpose: a name nothing declares
// keeps its named refusal — see 7324.)
// The tokens for globals that DO exist are unaffected: identity still flows.
console.log(globalThis.JSON === globalThis.JSON);
console.log(typeof globalThis.process.argv.length);
