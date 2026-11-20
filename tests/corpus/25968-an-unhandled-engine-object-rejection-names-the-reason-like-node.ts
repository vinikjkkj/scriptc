// @exit: 1
// A rejection nobody handles, whose reason is an object made by engine code (new Function): named `#<Object>`.
const mk: any = new Function("return { code: 1 }");
console.log("before");
const p: Promise<void> = Promise.reject(mk()); void p;
