// import() evaluates the module in a LATER job than the call site, once, in Node's order: side effects the module prints
// interleave with the microtasks queued around the call. 
console.log("1 main: start");
Promise.resolve().then(() => console.log("5 microtask queued before import()"));
const p = import("./lazy.ts");
console.log("2 main: import() returned a", typeof p);
Promise.resolve().then(() => console.log("6 microtask queued after import()"));
process.nextTick(() => console.log("4 nextTick"));
p.then((ns) => {
  console.log("7 then:", ns.value, ns.bump(1), Object.keys(ns).join(","));
  return import("./lazy.ts");
}).then(async (again) => {
  console.log("8 second import() of the same module reuses the evaluation:", again.value);
  const o = await import("./other.ts");
  console.log("9 other pulled lazy in without re-evaluating it:", o.doubled);
  console.log("10 third import():", (await import("./lazy.ts")).value);
});
console.log("3 main: end of synchronous code");
