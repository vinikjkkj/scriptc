// A rejection nobody handles ends the process with exit code 1 whatever the reason is; the output printed before it stays.
const p: Promise<void> = Promise.reject("boom");
console.log("before", typeof p);
setTimeout(() => console.log("timer still runs first"), 0);
