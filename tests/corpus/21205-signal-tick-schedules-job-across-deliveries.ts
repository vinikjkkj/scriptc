// listener I schedules a tick that schedules a microtask; listener T checks nothing of I beyond its own output
process.on("SIGINT", () => { console.log("I"); process.nextTick(() => { console.log("I tick"); Promise.resolve().then(() => console.log("I tick job")); }); });
process.on("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGTERM"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
