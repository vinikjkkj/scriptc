// @exit: 1
process.on("exit", (code) => console.log("exit", code));
console.log("before");
throw null;
