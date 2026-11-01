// An async function returns untyped values: a non-promise resolves to the value
// itself (awaited, or chained with .then), exactly as Node does.
async function f(o) { return o; }
function id(v) { return v; }
f(id(5)).then((v) => console.log("resolved", v));
(async () => { const v = await f(id("s")); console.log("awaited", v); })();
console.log("sync end");
