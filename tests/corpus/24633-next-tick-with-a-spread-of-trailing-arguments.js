// process.nextTick(cb, ...xs): the callback receives the spread's elements as its arguments, the arity decided at run time (autoPipelining's
// `process.nextTick(callbacks[i], ...results[i])`). Empty spreads, mixed leading arguments and several spreads included.
const callbacks = [
  (a, b) => console.log("two", a, b),
  (a) => console.log("one", a),
  (...all) => console.log("rest", all.length, all.join("|")),
  () => console.log("none"),
];
const results = [[1, 2], [3], [4, 5, 6], []];
for (let i = 0; i < callbacks.length; i++) {
  process.nextTick(callbacks[i], ...results[i]);
}
process.nextTick((...all) => console.log("mixed", all.join(",")), "lead", ...results[0], "mid", ...results[1], "tail");
process.nextTick((a, b, c) => console.log("string", a, b, c), ...("xyz"));
console.log("sync end");
