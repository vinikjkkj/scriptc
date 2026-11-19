// The SOURCE table is written after the cast: Node's wide name is the same object, so it reads the new value.
interface Entry { code: number; type: string; defaultValue: string | number | boolean }
const source = {
  alpha: { code: 41, type: "int", defaultValue: 1 },
  beta: { code: 42, type: "bool", defaultValue: true },
}
const wide = source as Record<"alpha" | "beta", Entry>
console.log(wide.alpha.defaultValue, wide.beta.defaultValue)
source.alpha.defaultValue = 2
source.beta.defaultValue = false
console.log(wide.alpha.defaultValue, wide.beta.defaultValue)
function read(n: "alpha" | "beta"): unknown { return wide[n].defaultValue }
console.log(read("alpha"), read("beta"))
