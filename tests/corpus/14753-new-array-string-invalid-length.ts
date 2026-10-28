// The same gate on a refcounted element array: the RangeError is raised before
// any slot is allocated, and a valid length right after still fills.
function names(n: number): string[] {
  const a: string[] = new Array(n)
  for (let i = 0; i < n; i++) a[i] = "n" + i
  return a
}
try {
  names(-2)
} catch (e) {
  console.log("threw", (e as Error).name, (e as Error).message)
}
console.log(names(2).join("|"))
