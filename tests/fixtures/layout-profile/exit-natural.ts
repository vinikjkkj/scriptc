// Ends by falling off the end of the program: the normal exit path, which runs destructors.
function work(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += i;
  return t;
}
console.log("work", work(10));
