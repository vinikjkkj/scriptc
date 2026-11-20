// @exit: 1
// A rejection nobody handles, whose reason is a class instance thrown inside an async function: the reason is named `#<Failure>`.
class Failure { code = "F1"; }
async function work(): Promise<void> { throw new Failure(); }
console.log("before");
void work();
