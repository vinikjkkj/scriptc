// Two classes, each with its own parameter position and its own fill site.
class Head {
  public readonly fields: number[]
  constructor(public readonly tag: string, public readonly n: number) {
    this.fields = new Array(n)
  }
}
class Body {
  public readonly cols: number[]
  public readonly name: string = "body"
  constructor(width: number) {
    this.cols = new Array(width)
  }
}
function readHead(k: number): Head {
  const h = new Head("h" + k, k)
  for (let i = 0; i < k; i++) h.fields[i] = 100 + i
  return h
}
function readBody(w: number): Body {
  const b = new Body(w)
  for (let i = 0; i < w; i++) b.cols[i] = w - i
  return b
}
const h = readHead(3)
console.log(h.tag, h.n, h.fields.join(" "))
const b = readBody(4)
console.log(b.name, b.cols.join(" "), b.cols.reduce((s, x) => s + x, 0))
