// once listeners on two signals, delivered in one batch: each runs once and its ticks and jobs run after its own delivery; a plain listener registered afterwards still gets the next INT
process.once("SIGINT", () => { console.log("I"); process.nextTick(() => console.log("I tick")); Promise.resolve().then(() => console.log("I job")); });
process.once("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); Promise.resolve().then(() => console.log("T job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGTERM"); }, 10);
setTimeout(() => {
  process.on("SIGINT", () => { console.log("re-armed INT"); });
  process.kill(process.pid, "SIGINT");
}, 60);
setTimeout(() => { console.log("done"); }, 200);
