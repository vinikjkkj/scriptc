// BYTES as a spread source: a typed array spreads element-by-element,
// a Buffer likewise. (Identity of the view type is another block's
// subject -- this probe only asks what the SPREAD produces.)
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
const u8 = new Uint8Array([1, 2, 255])
take(...u8)

const buf = Buffer.from("AB", "utf8")
take(...buf)

const empty = new Uint8Array(0)
take(...empty)

take("L", ...u8, "R")
