// CONTROL for the read-only rule: the literal lists its keys in an order the mapped target type does not (TypeScript orders `keyof` members by creation).
// Node's wide name is the same object, so JSON and Object.keys keep the literal's order. With the order check switched off (SCRIPTC_RECORD_WIDTH_MUTANT=
// ignoreorder) the cast becomes a copy in the target's order and this row prints another order.
interface Entry { readonly id: number; readonly flag: boolean | number }
const TABLE = Object.freeze({
  one: Object.freeze({ id: 1, flag: true }),
  two: Object.freeze({ id: 2, flag: 0 }),
  three: Object.freeze({ id: 3, flag: false }),
})
type K = keyof typeof TABLE
const WIDE = TABLE as Readonly<Record<K, Entry>>
for (const k of ["one", "two", "three"] as K[]) console.log(k, WIDE[k].id, WIDE[k].flag)
console.log(JSON.stringify(WIDE))
console.log(Object.keys(WIDE).join(","))
