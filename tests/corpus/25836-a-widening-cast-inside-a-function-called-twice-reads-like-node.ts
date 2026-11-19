// The read-only cast inside a function (two calls, two copies; nothing compares them) and the cast result returned and stored.
interface Item { readonly n: number; readonly label: string; readonly on: boolean | number }
function make(base: number) {
  const t = Object.freeze({
    a: Object.freeze({ n: base, label: "a" + base, on: true }),
    b: Object.freeze({ n: base + 1, label: "b" + base, on: 0 }),
  })
  return t as Readonly<Record<"a" | "b", Item>>
}
const x = make(1)
const y = make(10)
console.log(x.a.n, x.b.label, x.b.on, y.a.n, y.b.label, y.a.on)
const pick = (r: Readonly<Record<"a" | "b", Item>>, k: "a" | "b"): number => r[k].n
console.log(pick(x, "b"), pick(y, "a"))
