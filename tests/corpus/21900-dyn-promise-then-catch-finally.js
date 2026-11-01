// A checked-dynamic promise (an untyped call's result) takes then / catch /
// finally: resolve and reject paths, chained results, the two-handler then,
// and the microtask order against a typed promise.
function id(v) { return v; }
const ok = id(Promise.resolve(5));
const bad = id(Promise.reject(new Error("boom")));
console.log("sync 1");
ok.then((x) => console.log("then ok", x));
bad.catch((e) => console.log("catch bad", e.message));
ok.finally(() => console.log("finally ok"));
ok.then((x) => { console.log("then2", x); return x + 1; }).then((y) => console.log("chained", y));
bad.then((x) => console.log("never", x), (e) => console.log("two-handler", e.message));
Promise.resolve().then(() => console.log("micro A"));
const d = id(Promise.resolve("d"));
const t = Promise.resolve("t");
d.then((x) => console.log("d1", x));
t.then((x) => console.log("t1", x));
d.then((x) => console.log("d2", x));
t.then((x) => console.log("t2", x));
d.catch(() => console.log("never")).then((x) => console.log("d3", x));
t.finally(() => console.log("t-fin")).then((x) => console.log("t3", x));
console.log("sync 2");
