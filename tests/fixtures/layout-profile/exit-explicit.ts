// Ends with an explicit process.exit(0): the runtime leaves through _Exit, which skips every destructor and atexit handler.
function work(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += i;
  return t;
}
console.log("work", work(10));
process.exit(0);
