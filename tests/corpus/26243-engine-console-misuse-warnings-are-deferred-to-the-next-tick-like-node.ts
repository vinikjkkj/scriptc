// console.time/timeEnd/timeLog/count misuse inside new Function text emits process warnings on the NEXT tick (process.emitWarning
// defers with nextTick), so lines the text prints right after the misuse come first, and a static 'warning' listener sees them in order.
process.on("warning", (w) => console.log("warning event:", w.name, "|", w.message));
const run: any = new Function(`
  console.timeEnd("nope");
  console.log("after timeEnd");
  console.timeLog("nope");
  console.log("after timeLog");
  console.countReset("nope");
  console.log("after countReset");
  console.time("t"); console.time("t");
  console.log("after double time");
  return 1;
`);
console.log("before");
run();
console.log("static sync end");
Promise.resolve().then(() => console.log("static microtask"));
process.nextTick(() => console.log("static tick (queued after the warnings)"));
