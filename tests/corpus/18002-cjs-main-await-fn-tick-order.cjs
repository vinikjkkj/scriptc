// A CommonJS main body that calls an async function: the awaited
// continuation is a promise job, which runs after the body's nextTick.
async function f() {
  console.log("f-start");
  await null;
  console.log("f-after-await");
}
process.nextTick(() => console.log("main-tick"));
f();
console.log("sync");
