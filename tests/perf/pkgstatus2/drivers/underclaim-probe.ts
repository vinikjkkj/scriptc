// UNDER-CLAIMING declarations over a compiled body. The over-claiming
// direction was measured (claim-probe3: a checked TypeError naming the
// member). This is the other direction, the one that could produce a MISSING
// member rather than a loud one.
import { makeCodec } from '../claimlab/underclaim.js'

interface Underclaimed {
    // the body returns `string | null`; this claims `string`.
    find(k: string): string
    // `extra` is deliberately NOT declared.
    // the body's `count` is a number; this claims `string`.
    readonly count: string
}

const c = makeCodec() as unknown as Underclaimed

console.log('1 hit:', c.find('hit'))
const miss = c.find('miss')
console.log('2 miss, typeof:', typeof miss)
console.log('3 miss, length of a value the claim says is a string:', miss.length)
console.log('4 count, claimed string, body number:', c.count, typeof c.count)
