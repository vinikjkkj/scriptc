// CommonJS main body: the first checkpoint drains the ticks to exhaustion
// first, then the jobs; a tick queued by a job, and a job queued by a tick,
// keep their queues' order across the whole checkpoint.
console.log("sync");
Promise.resolve().then(() => {
  console.log("micro-a");
  process.nextTick(() => console.log("tick-from-micro"));
  Promise.resolve().then(() => console.log("micro-from-micro"));
});
process.nextTick(() => {
  console.log("tick-a");
  process.nextTick(() => console.log("tick-nested"));
  Promise.resolve().then(() => console.log("micro-from-tick"));
});
console.log("end-sync");
