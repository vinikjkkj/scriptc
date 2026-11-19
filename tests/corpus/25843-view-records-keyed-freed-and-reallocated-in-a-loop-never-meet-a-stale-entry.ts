// Each pass builds fresh tables, widens them by a cast, keys a Map by entries read through the cast and through the original, and drops everything. The
// next pass reuses the memory of the last: a registry entry that outlived its record would answer a record of the previous pass. Run with
// SCR_DYNVIEW_CHECK=1 the runtime verifies every hit and, at exit, that no entry outlived its record.
interface Entry { code: number; flag: boolean | number }
let ok = 0
let sum = 0
const kept: Entry[] = []
for (let i = 0; i < 3000; i++) {
  const t = { a: { code: i, flag: i % 2 === 0 }, b: { code: i + 1, flag: 0 } }
  const w = t as Record<"a" | "b", Entry>
  const m = new Map<Entry, number>()
  m.set(w.a, i)
  m.set(t.b as Entry, -i)
  if (m.get(w.a) === i && m.get(w.b) === -i && m.size === 2) ok++
  sum += m.get(t.a as Entry) ?? 0
  if (i % 500 === 0) kept.push(w.a)
}
console.log(ok, sum, kept.map((e) => e.code).join(","))
