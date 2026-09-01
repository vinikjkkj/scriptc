// The under-claim a boundary check CANNOT see: a METHOD's return type. The
// object's data all matches the claim; only what `find` returns at run time
// disagrees (the body can return null, the claim says string). A materialising
// check can inspect properties; it cannot inspect a future return value.
import { makeCodec } from '../claimlab/underclaim.js'

interface Underclaimed {
    find(k: string): string
    extra(): string
    readonly count: number
}

const c = makeCodec() as unknown as Underclaimed

console.log('1 hit:', c.find('hit'))
const miss = c.find('miss')
console.log('2 miss, typeof:', typeof miss)
console.log('3 miss === "":', (miss as unknown) === '')
let r = 'no throw'
try {
    r = 'length=' + String(miss.length)
} catch (e) {
    r = 'threw: ' + (e as Error).message
}
console.log('4 length through the claim:', r)
