// standard-as-callback's `ret === errorObj`: `ret: void | { e: Error }` against `errorObj: { e: {} }`. Identity needs the two shapes
// to be one struct; it used to be refused (SC1090) and a copy would have answered false where Node answers true.
const q: { e: Error } = { e: new Error('a') }
const w: { e: {} } = q
const other: { e: {} } = { e: new Error('other') }
function pick(flag: boolean): void | { e: Error } { return flag ? q : undefined }
const r = pick(true)
console.log(r === w, r !== w, r === other, pick(false) === w)
q.e = new Error('b')
console.log((w.e as Error).message)
w.e = new Error('c')
console.log(q.e.message, r === undefined ? 'none' : r.e.message)
