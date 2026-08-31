// ToIndex on the length argument: Node's RangeErrors, catchably, at the
// 2-byte stride.
function mk(n: number): void {
  try {
    const a = new Int16Array(n)
    console.log('ok', n, a.length, a.byteLength)
  } catch (e) {
    console.log('throw', n, (e as Error).name, (e as Error).message)
  }
}
mk(0)
mk(3)
mk(-1)
mk(1.5)
mk(NaN)
mk(Infinity)
mk(2 ** 53)
function mku(n: number): void {
  try {
    const a = new Uint16Array(n)
    console.log('u ok', n, a.length, a.byteLength)
  } catch (e) {
    console.log('u throw', n, (e as Error).name, (e as Error).message)
  }
}
mku(-1)
mku(2.5)
mku(NaN)
