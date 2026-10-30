// an unhandled rejection in a timer callback is fatal at that callback's checkpoint: the second timer never runs.
// the second timer must never print
setTimeout(() => {
  console.log("first");
  Promise.reject(new Error("boom"));
}, 0);
setTimeout(() => {
  console.log("second");
}, 0);
