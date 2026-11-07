// The Promise constructor VALUE carries its statics: resolve, reject, all, allSettled, race, any and try, read off the value and called
// the way Node does (a receiver that is not a constructor throws its TypeError). Combinators settle from inside the reactions on each
// element, so the microtask order matches, and a non-iterable argument REJECTS the result with V8's wording.
const P = Promise;
function show(tag, v) { console.log(tag, JSON.stringify(v)); }
function same(a, b) { return a === b; }
function isInst(a, C) { return a instanceof C; }
const log = (...a) => console.log(...a);

// statics read as values and called with no receiver
const res = P.resolve;
res.call(P, 1).then((v) => log("res", v));
try { res(1); } catch (e) { log(e.constructor.name, e.message); }
try { P.all.call(5, []); } catch (e) { log(e.constructor.name, e.message); }
P.reject.call(P, "r").catch((v) => log("rej", v));

// resolve returns the same promise for a promise, a new one otherwise
const pr = new P((r) => r(5));
log(same(P.resolve(pr), pr), same(P.resolve(5), pr), isInst(P.resolve(5), P));

// thenables as elements
const thenable = { then(ok) { ok("thenable"); } };
P.all([thenable, 2, P.resolve(3)]).then((v) => show("all thenable", v));
P.race([thenable, P.resolve(1)]).then((v) => log("race thenable", v));

// any: all rejected -> AggregateError, empty input, first fulfilled wins
P.any([P.reject(1), P.reject(2)]).catch((e) => log(e.constructor.name, e.message, JSON.stringify(e.errors), isInst(e, AggregateError)));
P.any([]).catch((e) => log("any empty", e.constructor.name, e.errors.length));
P.any([P.reject(1), new P((r) => setTimeout(() => r("late"), 5)), P.resolve("early")]).then((v) => log("any", v));

// all: first rejection wins; empty fulfils with []; order of values is the input order
P.all([new P((r) => setTimeout(() => r("slow"), 5)), P.resolve("fast")]).then((v) => show("all order", v));
P.all([P.resolve(1), P.reject(new Error("boom")), P.reject(new Error("second"))]).catch((e) => log("all reject", e.message));
P.all([]).then((v) => show("all empty", v));
P.allSettled([]).then((v) => show("settled empty", v));
P.race([]); // never settles: nothing is attached, so the program still ends

// iterables other than arrays
P.all(new Set([1, 2, 3])).then((v) => show("all set", v));
P.all("ab").then((v) => show("all string", v));
P.all(5).catch((e) => log("all 5", e.constructor.name, e.message));
P.all().catch((e) => log("all none", e.constructor.name, e.message));

// try
P.try(() => "sync").then((v) => log("try", v));
P.try((a, b) => a + b, 2, 3).then((v) => log("try args", v));
P.try(() => { throw new Error("tried"); }).catch((e) => log("try throw", e.message));

// microtask ordering against plain then chains
P.resolve().then(() => log("tick 1")).then(() => log("tick 2")).then(() => log("tick 3"));
P.all([1]).then(() => log("all tick"));
P.resolve("a").then(() => log("resolve tick"));
log("sync end");
