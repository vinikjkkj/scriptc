// The other half: the dynamic import, with the result kept as `unknown`.
let ready: Promise<unknown> | null = null
export function load(): Promise<unknown> {
    if (!ready) ready = import('libmlow-wasm')
    return ready
}
console.log('load is', typeof load)
