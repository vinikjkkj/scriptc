// Retyped slots of scalar kinds and a subclass instance: the narrow record is built by literals and read/written typed,
// the wide one sees every write, and enumeration prints one object.
type Narrow = { n: number; s: string; ok: boolean; err: Error }
type Wide = { n: unknown; s: unknown; ok: unknown; err: {} }
function make(i: number): Narrow {
  return { n: i, s: "s" + i, ok: i % 2 === 0, err: new RangeError("r" + i) }
}
const a = make(1)
const w: Wide = a
a.n = 2
a.s = "two"
console.log(w.n, w.s, w.ok, (w.err as Error).message)
const w2: Wide = a
w.n = 3
w.ok = false
w.err = new TypeError("t")
console.log(a.n + 1, a.ok, a.err.message, a.err instanceof TypeError)
console.log(JSON.stringify(w), Object.keys(w).join(","), w === w2)
let sum = 0
for (let i = 0; i < 100; i++) {
  const x = make(i)
  sum += x.n + x.s.length + (x.ok ? 1 : 0) + x.err.message.length
}
console.log(sum)
