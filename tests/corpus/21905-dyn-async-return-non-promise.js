// An untyped value returned from an async function, then awaited in a caller:
// a number, a string, an object and undefined each settle to themselves.
async function pass(v) { return v; }
function id(v) { return v; }
async function main() {
  console.log(await pass(id(42)));
  console.log(await pass(id("text")));
  console.log(await pass(id({ k: 1 })).then((o) => o.k));
  console.log(await pass(id(undefined)));
  console.log("sync end");
}
main();
console.log("before main");
