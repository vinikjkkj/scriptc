// A rejecting entry inside Promise.all over an any-typed array: awaited with
// try/catch, and a chained catch on a second combinator over the same array.
const arr = [];
arr.push(Promise.resolve(1));
arr.push(Promise.reject(new Error("e2")));
async function go() {
  try { const v = await Promise.all(arr); console.log("await ok", v.length); }
  catch (e) { console.log("await caught", e.message); }
}
go().then(() => console.log("go done"));
Promise.all(arr).then((v) => console.log("never", v)).catch((e) => console.log("chain catch", e.message));

const set = new Set();
set.add(Promise.resolve("ok"));
const p = Promise.all(set).catch((e) => { console.log("no", e); });
p.then(() => console.log("set done"));
