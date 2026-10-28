// Fractional, NaN, Infinity and 2^32 lengths are all RangeError "Invalid array length".
function build(n: number): number[] {
  const a = new Array(n)
  for (let i = 0; i < n; i++) a[i] = i + 1
  return a
}
for (const n of [1.5, NaN, Infinity, 4294967296]) {
  try {
    console.log("built", build(n).length)
  } catch (e) {
    console.log("threw", (e as Error).name, (e as Error).message)
  }
}
