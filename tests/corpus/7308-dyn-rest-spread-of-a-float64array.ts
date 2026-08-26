// A Float64Array spread source, isolated: the checked-dynamic tier has
// to be able to hold the source, and this probe records whether it can.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
function take(...args: unknown[]): void {
  console.log(fmt(args))
}
const f64 = new Float64Array([1.5, 2.5])
take(...f64)
