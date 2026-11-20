// @exit: 1
// A rejection nobody handles, whose reason is a plain object: Node reports an UnhandledPromiseRejection naming the reason as `#<Object>`.
console.log("before");
const p: Promise<void> = Promise.reject({ code: "U1", message: "unhandled" });
void p;
