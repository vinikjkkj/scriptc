setImmediate(() => { console.log("I1"); process.nextTick(() => console.log("I1 tick")); Promise.resolve().then(() => console.log("I1 job")); });
setImmediate(() => { console.log("I2"); process.nextTick(() => console.log("I2 tick")); Promise.resolve().then(() => console.log("I2 job")); });
setImmediate(() => { console.log("I3"); process.nextTick(() => console.log("I3 tick")); Promise.resolve().then(() => console.log("I3 job")); });
