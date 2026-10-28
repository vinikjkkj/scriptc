// `new Array(n)` with a negative n is ArrayCreate's RangeError, not the
// ToLength empty array Array.from({ length: n }) gives. The fill loop never runs.
function build(n: number): number[] {
  const a = new Array(n)
  for (let i = 0; i < n; i++) a[i] = i * 2
  return a
}
for (const n of [-1, -5]) {
  try {
    console.log("built", build(n).length)
  } catch (e) {
    console.log("threw", (e as Error).name, (e as Error).message)
  }
}
console.log("after", 1)
