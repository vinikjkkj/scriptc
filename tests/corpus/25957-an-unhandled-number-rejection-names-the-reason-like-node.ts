// @exit: 1
// A rejection nobody handles, whose reason is a number: the report names the reason as its ToString.
async function work(): Promise<void> { throw 42; }
console.log("before");
void work();
