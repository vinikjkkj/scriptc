// CONTROL for the read-only rule: the identity of the source table is observed (a Map keyed by it, looked up through the cast). Node has one object, so
// the lookup finds the entry. With the identity census switched off (SCRIPTC_RECORD_WIDTH_MUTANT=ignoreidentity) the cast is a copy and the lookup misses.
interface Entry { readonly code: number; readonly type: string; readonly defaultValue: string | number | boolean }
const TABLE = Object.freeze({
  alpha: Object.freeze({ code: 31, type: "bool", defaultValue: false }),
  beta: Object.freeze({ code: 32, type: "int", defaultValue: 7 }),
})
type Name = keyof typeof TABLE
const WIDE = TABLE as Readonly<Record<Name, Entry>>
const seen = new Map<unknown, string>()
seen.set(TABLE, "table")
console.log(seen.get(WIDE as unknown), seen.has(WIDE as unknown), seen.size)
console.log(WIDE.beta.defaultValue)
