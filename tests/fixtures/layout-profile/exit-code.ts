// Sets process.exitCode and ends naturally: the last atexit handler leaves through _Exit with that status, again skipping destructors.
function work(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += i;
  return t;
}
console.log("work", work(10));
process.exitCode = 3;
