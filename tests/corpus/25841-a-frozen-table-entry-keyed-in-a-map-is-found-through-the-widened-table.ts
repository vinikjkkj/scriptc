// The frozen form of the same defect: an entry read off a frozen table is a Map key, and the lookup reads the same entry through a cast of the table
// to a wider record type. Node has one object; the cast's view must answer one record too, on every read, in a callee and in a Set.
interface Entry { readonly code: number; readonly flag: boolean | number }
const TABLE = Object.freeze({
  alpha: Object.freeze({ code: 1, flag: true }),
  beta: Object.freeze({ code: 2, flag: 0 }),
})
type Name = keyof typeof TABLE
type Wide = Readonly<Record<Name, Entry>>
const WIDE = TABLE as Wide
const registry = new Map<Entry, string>()
registry.set(TABLE.alpha, "first")
console.log(registry.get(WIDE.alpha), registry.has(WIDE.alpha), registry.has(WIDE.beta))
const a = WIDE.alpha
const b = WIDE.alpha
function lookup(m: Map<Entry, string>, e: Entry): string | undefined { return m.get(e) }
console.log(lookup(registry, a), lookup(registry, b), a === b, a === WIDE.alpha)
const seen = new Set<Entry>([WIDE.beta])
console.log(seen.has(WIDE.beta), seen.has(a), seen.size)
