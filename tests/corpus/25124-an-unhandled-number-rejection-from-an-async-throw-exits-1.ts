// The same for a number thrown inside an async function: nothing awaits it, so the process exits with code 1.
async function fail(): Promise<number> {
  throw 42;
}
fail();
console.log("after the call");
