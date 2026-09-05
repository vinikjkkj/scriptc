// Enumeration over an `any`-valued overflow store: Object.keys, for...in,
// `in`, delete, spread, JSON.stringify, and a key that is not there --
// which must read back `undefined`, not trap.
// The declared field of a hybrid shape enumerates beside the store's keys
// in declaration order, the same order node produces.
interface Doc { [key: string]: any }
interface Hybrid { _id: string; [key: string]: any }

const d: Doc = { a: 1, b: 'two', c: true }
console.log(Object.keys(d).join(','))
for (const k in d) console.log('in', k, String(d[k]))

console.log('a' in d, 'zz' in d)
console.log(String(d.zz), d.zz === undefined, typeof d.zz)
console.log(String(d['also-missing']), d['also-missing'] === undefined)

const sp: Doc = { ...d, e: 5 }
console.log(Object.keys(sp).join(','))
console.log(JSON.stringify(sp))

delete d.a
console.log(Object.keys(d).join(','), JSON.stringify(d))

const h: Hybrid = { _id: 'id-1', extra: 42, more: 'm' }
console.log(h._id, String(h.extra))
console.log(Object.keys(h).join(','))
for (const k in h) console.log('h', k)
console.log(JSON.stringify(h))
console.log(String(h.nope), h.nope === undefined)
