// The protobuf shape, reproduced locally: a compiled BODY whose method takes
// three parameters, and a DECLARATION that claims two. If the call lowers
// against the claim, the binary and node must still agree - node passes
// undefined for the missing third argument, so the answer is the same either
// way unless the compiler invents one.
import { makeCodec } from '../claimlab/body.js'

interface ClaimedCodec {
    readonly tag: string
    encode(a: number, b: number): string
}

const claimed = makeCodec() as unknown as ClaimedCodec
console.log('1 tag:', claimed.tag)
console.log('2 encode via the claim:', claimed.encode(1, 2))
