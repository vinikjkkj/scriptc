// The DANGEROUS shape: the claim declares members the compiled body does not
// have at all - a property and a method. node answers `undefined` for the
// property and throws a TypeError for the call.
import { makeCodec } from '../claimlab/body.js'

interface Overclaimed {
    readonly tag: string
    readonly version: number
    decode(s: string): string
}

const c = makeCodec() as unknown as Overclaimed
console.log('1 tag:', c.tag)
console.log('2 version the body does not have:', c.version)
let r = 'no throw'
try {
    r = c.decode('x')
} catch (e) {
    r = 'threw: ' + (e as Error).message
}
console.log('3 decode the body does not have:', r)
