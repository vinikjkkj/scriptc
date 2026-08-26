// A UNION spread source. The dyn box carries the ACTIVE arm, so the walk
// steps it exactly when every arm is a kind the walk steps: an array, a
// string, a Uint8Array. Both arms of each union below are taken.
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

function textOrBytes(which: boolean): string | Uint8Array {
  if (which) {
    return "hi"
  }
  return new Uint8Array([7, 8])
}
take(...textOrBytes(true))
take(...textOrBytes(false))
take("L", ...textOrBytes(true), ...textOrBytes(false), "R")

function listOrText(which: boolean): number[] | string {
  if (which) {
    return [1, 2]
  }
  return "xy"
}
take(...listOrText(true))
take(...listOrText(false))
