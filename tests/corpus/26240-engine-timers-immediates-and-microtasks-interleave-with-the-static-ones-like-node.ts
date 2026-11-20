// An engine-only build (new Function text, no npm): setTimeout, setInterval, setImmediate and queueMicrotask inside the text ride the
// native loop, so they interleave with the static timers, check phase and microtask queue in Node's order.
const run: any = new Function(`
  const log = console.log;
  setTimeout(() => log("E timeout 400"), 400);
  setTimeout(() => log("E timeout 800"), 800);
  setTimeout((a, b) => log("E timeout args", a, b), 1200, "x", "y");
  let n = 0;
  const iv = setInterval(() => { log("E interval", ++n); if (n === 3) clearInterval(iv); }, 300);
  const cancelled = setTimeout(() => log("E NEVER"), 10);
  clearTimeout(cancelled);
  setImmediate(() => log("E immediate"));
  queueMicrotask(() => log("E microtask"));
  Promise.resolve().then(() => log("E promise"));
  log("E sync end");
`);
setTimeout(() => console.log("S timeout 500"), 500);
setTimeout(() => console.log("S timeout 1000"), 1000);
setImmediate(() => console.log("S immediate"));
Promise.resolve().then(() => console.log("S promise before"));
queueMicrotask(() => console.log("S microtask before"));
run();
Promise.resolve().then(() => console.log("S promise after"));
queueMicrotask(() => console.log("S microtask after"));
process.nextTick(() => console.log("S nextTick"));
console.log("S sync end");
