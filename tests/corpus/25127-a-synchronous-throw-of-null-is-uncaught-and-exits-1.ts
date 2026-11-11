// `throw null` with no handler: the output before it is kept and the process exits with code 1.
function fail(): void {
  throw null;
}
console.log("before");
fail();
console.log("never printed");
