// bson long.ts:701 shape: `approx -= delta` inside a while whose condition calls
// methods on a class instance.
class L { neg(): boolean { return false } gt(o: number): boolean { return o < 1 } }
export function d(approx: number, delta: number): number {
  const r = new L()
  while (r.neg() || r.gt(approx)) { approx -= delta }
  return approx
}
console.log(d(10, 1))
