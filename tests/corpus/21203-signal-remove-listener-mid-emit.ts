// a listener removes another on the same signal during the emit; second signal in batch
const L2 = () => { console.log("L2 ran"); process.nextTick(() => console.log("L2 tick")); };
process.on("SIGINT", () => { console.log("L1"); process.nextTick(() => console.log("L1 tick")); process.off("SIGINT", L2); Promise.resolve().then(() => console.log("L1 job")); });
process.on("SIGINT", L2);
process.on("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); Promise.resolve().then(() => console.log("T job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGTERM"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
