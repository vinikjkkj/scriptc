// same as sg1 but TERM is delivered first
process.on("SIGINT", () => { console.log("I"); process.nextTick(() => console.log("I tick")); Promise.resolve().then(() => console.log("I job")); });
process.on("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); Promise.resolve().then(() => console.log("T job")); });
setTimeout(() => { process.kill(process.pid, "SIGTERM"); process.kill(process.pid, "SIGINT"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
