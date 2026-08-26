// A SET as a spread source.
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

const st = new Set<number>([1, 2, 2, 3])
take(...st)

take("L", ...st, "R")

const empty = new Set<number>()
take(...empty)

const strs = new Set<string>(["a", "b"])
take(...strs, ...st)
