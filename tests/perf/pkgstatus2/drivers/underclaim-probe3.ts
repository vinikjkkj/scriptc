// (ii) The assignability check that makes the exception safe DOES NOT FIRE
// when the compiled body's inferred type is `any`. No `as` cast anywhere:
// the annotation alone binds the claim to the value.
import { makeCodec } from '../claimlab/anybody.js'

interface Underclaimed {
    find(k: string): string
    readonly count: number
}

const c: Underclaimed = makeCodec()

console.log('1 hit:', c.find('hit'))
const miss = c.find('miss')
console.log('2 miss, typeof:', typeof miss)
console.log('3 count:', c.count)
