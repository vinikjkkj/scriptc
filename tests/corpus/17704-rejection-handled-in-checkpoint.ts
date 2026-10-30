// a rejection handled from a tick inside the same checkpoint is not fatal.
setTimeout(() => {
  const p = Promise.reject(new Error("late"));
  process.nextTick(() => p.catch((e) => console.log("caught", e.message)));
  console.log("first");
}, 0);
setTimeout(() => {
  console.log("second");
}, 0);
