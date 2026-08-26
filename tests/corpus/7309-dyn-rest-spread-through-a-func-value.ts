// restPackedArgs: the call THROUGH a func-typed VALUE whose last
// parameter is a dyn rest -- store-sqlite's `statement.run(...params)`
// shape, reduced to its call form.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
type Runner = (sql: string, ...params: unknown[]) => string
const run: Runner = (sql: string, ...params: unknown[]): string => {
  return sql + " <- " + fmt(params)
}
const ps: unknown[] = ["a", 2, true]
console.log(run("INSERT", ...ps))
console.log(run("INSERT", "fixed", ...ps))
console.log(run("INSERT", ...ps, "tail"))
console.log(run("INSERT"))
const none: unknown[] = []
console.log(run("INSERT", ...none))

// A func-typed value whose ONLY parameter is the dyn rest.
type All = (...xs: unknown[]) => number
const count: All = (...xs: unknown[]): number => xs.length
console.log(String(count(...ps)))
console.log(String(count(...ps, ...ps)))

// A value held in an object member, called through the member.
const holder: { fn: Runner } = { fn: run }
console.log(holder.fn("UPDATE", ...ps))
