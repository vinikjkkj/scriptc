// An out-of-range element read returned from a function whose declared return
// type is `string | undefined`: the miss is the undefined arm, not a trap.
function pick(a: string[], i: number): string | undefined {
  return a[i];
}
console.log(pick(["x", "y"], 5));
console.log(pick(["x", "y"], 1));
console.log(pick(["x", "y"], 9) === undefined);
