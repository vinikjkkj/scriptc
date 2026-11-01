setTimeout(() => { console.log("T1"); process.nextTick(() => console.log("T1 tick")); Promise.resolve().then(() => console.log("T1 job")); }, 5);
setTimeout(() => { console.log("T2"); process.nextTick(() => console.log("T2 tick")); Promise.resolve().then(() => console.log("T2 job")); }, 5);
setTimeout(() => { console.log("T3"); process.nextTick(() => console.log("T3 tick")); Promise.resolve().then(() => console.log("T3 job")); }, 5);
