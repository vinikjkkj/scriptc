// Valid lengths (0, -0, 3) still build an array of that length, filled in order.
function build(n: number): number[] {
  const a = new Array(n)
  for (let i = 0; i < n; i++) a[i] = i * 10
  return a
}
console.log(build(0).length, build(-0).length, build(3).join(","))
console.log(build(4).reduce((s, x) => s + x, 0))
