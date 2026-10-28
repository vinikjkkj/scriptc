// A boolean element read past the end, returned as `boolean | undefined`.
function flag(a: boolean[], i: number): boolean | undefined {
  return a[i];
}
console.log(flag([true], 3), flag([true], 0));
