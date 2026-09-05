// A split generic family meets the two mechanisms merged before it: an
// `async` method whose vtable entry is the synthesized spawn thunk, and an
// override that WIDENS the slot with a trailing optional parameter. Both
// reached through a base-typed reference at two instantiations, so a slot
// typed off the wrong declarer would show as a wrong body or a wrong
// argument, not as a diagnostic.
class Src<T> {
  items: T[]
  constructor(items: T[]) { this.items = items }
  async first(): Promise<string> { return 'src:' + this.render('/') }
  render(sep: string): string { let s = ''; for (const i of this.items) { s = s === '' ? String(i) : s + sep + String(i) } return s }
}
class Tagged<T> extends Src<T> {
  tag: string
  constructor(items: T[], tag: string) { super(items); this.tag = tag }
  async first(): Promise<string> { return this.tag + ':' + this.render('/') }
  render(sep: string, prefix?: string): string {
    let s = ''
    for (const i of this.items) { s = s === '' ? String(i) : s + sep + String(i) }
    return (prefix ?? '') + s
  }
}

async function main(): Promise<void> {
  const a: Src<number> = new Tagged<number>([1, 2, 3], 'A')
  const b: Src<string> = new Tagged<string>(['x', 'y'], 'B')
  const c: Src<number> = new Src<number>([9])
  console.log(await a.first(), await b.first(), await c.first())
  console.log(a.render('-'), b.render('+'), c.render('.'))
  const t = new Tagged<number>([4, 5], 'T')
  console.log(t.render('-', '>>'), t.tag)
}
void main()
