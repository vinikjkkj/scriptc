// Is String.prototype.replace unsupported in general, or only in voip's spelling?
declare const s: string
const a = s.replace('@', ':0@')                 // two string args, voip's exact shape
console.log('a=' + a)
const b = 'x@y'.replace('@', '-')               // literal receiver
console.log('b=' + b)
const c = s.replace(/@/, '-')                   // regex pattern
console.log('c=' + c)
const d = s.replaceAll('@', '-')
console.log('d=' + d)

// and Array.isArray narrowing, relay-ack.ts:36's shape
declare const content: string | Uint8Array | { tag: string }[] | undefined
if (Array.isArray(content)) {
    for (const n of content) {
        console.log('tag=' + n.tag)
    }
}
