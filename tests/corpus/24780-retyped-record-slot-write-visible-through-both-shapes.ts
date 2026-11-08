// `{ e: Error }` flowing into `{ e: {} }` (a checked-dynamic slot) is TypeScript's relabel: one object, a write through either
// name is read through the other. The record used to be copied (the late write below printed the first error).
const q: { e: Error } = { e: new Error('first') }
const w: { e: {} } = q
q.e = new Error('second')
console.log((w.e as Error).message)
w.e = new Error('third')
console.log(q.e.message)
