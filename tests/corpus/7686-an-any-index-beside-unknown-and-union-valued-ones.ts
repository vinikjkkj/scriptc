// The three spellings of an index signature whose value is not one type,
// side by side and interchanged: `any`, `unknown`, and a union. `any` and
// `unknown` describe the SAME store and intern to one shape, so a value
// declared under one spelling enters a slot declared under the other; a
// UNION-valued signature is a different store and keeps its own narrowing.
// Nested one inside another, and through a generic at both.
interface AnyDoc { [key: string]: any }
interface UnkDoc { [key: string]: unknown }
interface UniDoc { [key: string]: number | string }

class Cell<T> { v: T; constructor(v: T) { this.v = v } }

function fromAny(d: AnyDoc): string { return String(d.k) }
function fromUnk(d: UnkDoc): string { return String(d.k) }

const a: AnyDoc = { k: 1, nested: { k: 'inner' } as AnyDoc }
const u: UnkDoc = { k: 'u' }
const n: UniDoc = { k: 2, s: 'str' }

console.log(fromAny(a), fromUnk(u))
console.log(fromAny(u as AnyDoc), fromUnk(a as UnkDoc))

const inner: AnyDoc = a.nested
console.log(String(inner.k))

// the union store narrows the way a union always does
const v = n.k
if (typeof v === 'number') console.log('num', v + 1)
else console.log('str', v.length)
console.log(typeof n.s, String(n.missing))

const ca = new Cell<AnyDoc>({ k: 'ca' })
const cu = new Cell<UnkDoc>({ k: 'cu' })
const cn = new Cell<UniDoc>({ k: 3 })
console.log(String(ca.v.k), String(cu.v.k), String(cn.v.k))

// an `unknown` read still needs its cast; an `any` read does not
const viaUnk: string = cu.v.k as string
const viaAny: string = ca.v.k
console.log(viaUnk.length, viaAny.length)
