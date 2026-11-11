// A plain object as the reason, unhandled: exit code 1.
const p: Promise<void> = Promise.reject({ code: 7, text: "x" });
console.log("started", typeof p);
