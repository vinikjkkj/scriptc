// A RangeError from one call does not leak into the next call's array.
function build(n: number): number[] {
  const a = new Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  return a
}
let caught = 0
for (const n of [2, -1, 3, 1.5, 1]) {
  try {
    console.log("len", build(n).length)
  } catch (e) {
    caught++
    console.log("caught", (e as RangeError).name)
  }
}
console.log("caught", caught)
