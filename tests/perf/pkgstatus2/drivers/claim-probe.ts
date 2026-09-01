// Does a CALL through a declaration whose body the compiler does not have
// lower to a direct call, or does it fence? This is the whole safety question
// for admitting a type-only declaration from a package's own .d.ts.
declare function opaque(): Claimed
interface Claimed {
    readonly tag: string
    encode(a: number, b: number): string
}
const c = opaque()
console.log('tag:', c.tag)
console.log('encode:', c.encode(1, 2))
