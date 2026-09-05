// The read side. tsc lets an `any`-typed read flow into ANY slot with no
// cast written; the store is the checked-dynamic one, so each read is a
// checked conversion to the destination's type. Three primitives, a
// composite, an array element, a Map, a class instance, and a function --
// each landing in a slot whose static type the value actually has.
interface Doc { [key: string]: any }
interface Point { x: number; y: number }
class Tag { name: string; constructor(name: string) { this.name = name } }

const d: Doc = {
  n: 7,
  s: 'seven',
  b: true,
  p: { x: 1, y: 2 },
  arr: [1, 2, 3],
  m: new Map<string, number>([['k', 9]]),
  t: new Tag('t'),
  f: (a: number) => a * 2,
}

const n: number = d.n
const s: string = d.s
const b: boolean = d.b
const p: Point = d.p
const arr: number[] = d.arr
const m: Map<string, number> = d.m
const t: Tag = d.t
const f: (a: number) => number = d.f

console.log(n + 1, s + '!', b ? 'T' : 'F')
console.log(p.x + p.y, arr.length, arr[2])
console.log(m.get('k'), t.name, f(21))

// The same read used at its own type without a destination annotation.
console.log(typeof d.n, typeof d.s, typeof d.b)
console.log(String(d.s).toUpperCase(), String(d.n))
