// A let alias of process.stderr keeps the state reads; the alias and the
// direct dynamic read agree on every member answered.
let alias: any = process.stderr;
const direct: any = process.stderr;
console.error("alias writable " + String(alias.writable) + " hwm " + String(alias.writableHighWaterMark));
console.error("direct corked " + String(direct.writableCorked) + " closed " + String(direct.closed));
console.log("stderr state reads done: " + String(alias.writable === direct.writable));
