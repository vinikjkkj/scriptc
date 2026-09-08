// Does `instanceof Uint8Array` narrow the FALSE branch for String()?
declare const a: string | Uint8Array
declare const b: string | Uint8Array | undefined
declare const c: string | Uint8Array | { tag: string }
declare const d: string | Uint8Array | (string | Uint8Array)[]

const A = a instanceof Uint8Array ? 'bytes' : String(a)
console.log('A=' + A)
const B = b instanceof Uint8Array ? 'bytes' : String(b)
console.log('B=' + B)
const C = c instanceof Uint8Array ? 'bytes' : String(c)
console.log('C=' + C)
const D = d instanceof Uint8Array ? 'bytes' : String(d)
console.log('D=' + D)
