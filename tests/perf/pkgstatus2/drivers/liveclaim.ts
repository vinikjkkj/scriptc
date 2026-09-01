// MINIMAL REPRO of a live silent wrong answer. No --npm-static, no `as unknown
// as` on the value, nothing exotic: JS whose return the checker infers as
// `any`, bound to an annotation that under-claims what the value can be.
import { config } from '../claimlab/plain.js'

interface Settings {
    readonly name: string
}

const s: Settings = config('{"name":null}')
console.log('1 name typeof:', typeof s.name)
console.log('2 name === null:', (s.name as unknown) === null)
