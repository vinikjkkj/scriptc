// A constructor allocates an array field from its count parameter; the one
// construction site fills every index by a counting loop before reading it.
class Msg {
  public readonly ids: number[]
  constructor(public readonly count: number) {
    this.ids = new Array(this.count)
  }
}
function parse(n: number): Msg {
  const m = new Msg(n)
  for (let i = 0; i < n; i++) m.ids[i] = i * 3 + 1
  return m
}
const a = parse(4)
console.log(a.count, a.ids.length, a.ids.join(","))
console.log(parse(0).ids.length, parse(2).ids.map((x) => x * 2).join("/"))
