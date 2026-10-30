// setImmediate callbacks of one check phase: each callback's ticks and promise jobs run before the next callback.
setImmediate(() => {
  console.log("a");
  process.nextTick(() => console.log("a-tick"));
  Promise.resolve().then(() => console.log("a-micro"));
});
setImmediate(() => {
  console.log("b");
  process.nextTick(() => {
    console.log("b-tick");
    Promise.resolve().then(() => console.log("b-tick-micro"));
  });
});
setImmediate(() => {
  console.log("c");
  Promise.resolve().then(() => console.log("c-micro"));
  process.nextTick(() => console.log("c-tick"));
});
