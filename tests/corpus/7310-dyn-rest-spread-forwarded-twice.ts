// The rest-FORWARDING idiom, two hops. Each hop repacks the whole list,
// so the arity has to survive both.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
function sink(...args: unknown[]): void {
  console.log(fmt(args))
}
function forward(...args: unknown[]): void {
  sink(...args)
}
forward()
forward(1)
forward(1, "two", true)
const xs: unknown[] = [7, 8]
forward(...xs)
forward("head", ...xs, "tail")

function hop(...args: unknown[]): void {
  forward(...args)
}
hop("a", ...xs)
hop()
