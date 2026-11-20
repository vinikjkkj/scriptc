// @exit: 1
// A rejection nobody handles, whose reason is false, thrown inside an async function.

console.log("before");
async function w(): Promise<void> { throw false; } void w();
