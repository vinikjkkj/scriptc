// One table cast to two different record types, written through the narrow one: the source and the wide name see the write (Node: one object).
interface Narrow { code: number; type: string }
interface Wide { code: number; type: string; defaultValue: string | number | boolean }
const table = {
  alpha: { code: 51, type: "bool", defaultValue: false },
  beta: { code: 52, type: "int", defaultValue: 7 },
}
const wide = table as Record<"alpha" | "beta", Wide>
const narrow = table as Record<"alpha" | "beta", Narrow>
narrow.beta.code = 5
narrow.alpha.type = "t"
console.log(table.beta.code, wide.beta.code, narrow.beta.code, table.alpha.type, wide.alpha.type)
