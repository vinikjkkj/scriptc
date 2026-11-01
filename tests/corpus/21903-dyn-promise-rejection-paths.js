// Rejections on a checked-dynamic promise: catch recovers, a missing handler
// passes the rejection on, and a two-handler then routes it to the second
// handler. The settled value passes through a catch-less then.
function id(v) { return v; }
const r = id(Promise.reject(new Error("e1")));
r.catch((e) => console.log("c1", e.message)).then((v) => console.log("after catch", v));
const s = id(Promise.resolve("sv"));
s.then(null, (e) => console.log("never", e)).then((v) => console.log("pass", v));
r.then((v) => console.log("never2", v)).catch((e) => console.log("c4", e.message));
r.then(() => console.log("never3"), (e) => console.log("two-handler", e.message));
