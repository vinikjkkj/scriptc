// The two boundary arities at the dyn rest slot: a spread of an EMPTY
// array contributes nothing, a spread of a ONE-element array contributes
// exactly one. Both with and without fixed neighbours.
function take(...args: unknown[]): void {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  console.log(line + "]")
}
const zero: unknown[] = []
const one: unknown[] = ["only"]
take(...zero)
take(...one)
take("L", ...zero)
take("L", ...one)
take(...zero, "R")
take(...one, "R")
take("L", ...zero, "R")
take("L", ...one, "R")
take(...zero, ...zero)
take(...zero, ...one)
take(...one, ...zero)
take(...one, ...one)
