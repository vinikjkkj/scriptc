// A frozen literal table of records, cast to a wider record type and read through the cast: keyed reads by a computed name, member reads, the enumeration
// and the JSON of the table all answer what Node answers. Nothing writes either side and nothing observes identity, so the cast is a plain field copy.
interface Entry { readonly code: number; readonly type: string; readonly defaultValue: string | number | boolean }
const TABLE = Object.freeze({
  alpha: Object.freeze({ code: 11, type: "bool", defaultValue: false }),
  beta: Object.freeze({ code: 12, type: "int", defaultValue: 7 }),
  delta: Object.freeze({ code: 14, type: "bool", defaultValue: true }),
  gamma: Object.freeze({ code: 13, type: "string", defaultValue: "x" }),
})
type Name = keyof typeof TABLE
const WIDE = TABLE as Readonly<Record<Name, Entry>>
function dv(n: Name): unknown { return WIDE[n].defaultValue }
const names: Name[] = ["alpha", "beta", "gamma", "delta"]
for (const n of names) console.log(n, dv(n), typeof dv(n), WIDE[n].type, WIDE[n].code)
console.log(WIDE.gamma.code, WIDE.beta.defaultValue)
console.log(JSON.stringify(WIDE))
console.log(Object.keys(WIDE).join(","), Object.keys(WIDE.beta).join(","))
