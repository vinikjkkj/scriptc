// @exit: 9
// process.on('uncaughtException'): the escaped throw of the entry body and of
// later turns is handed to the listeners as (error, origin) and
// execution CONTINUES: the loop runs the remaining timers, 'exit' listeners
// see the final status (process.exitCode set by a listener decides it), a
// once-listener fires once, off() removes one, and a non-Error value arrives
// as itself. Node is the oracle for stdout and the exit status.
process.on("exit", (code) => console.log("exit", code, process.exitCode));
const seen = [];
function first(e, origin) {
  seen.push("first");
  console.log("first", e instanceof Error ? e.message : e, typeof origin);
}
process.on("uncaughtException", first);
process.once("uncaughtException", (e) => console.log("once", e instanceof Error ? e.message : e));
process.on("uncaughtException", (e) => {
  if (e === 42) process.exitCode = 9;
});

setTimeout(() => {
  throw new Error("turn 1");
}, 2);
setTimeout(() => {
  process.off("uncaughtException", first);
  throw 42;
}, 6);
setTimeout(() => console.log("last timer", seen.join(",")), 12);
console.log("body start");
throw new Error("body");
