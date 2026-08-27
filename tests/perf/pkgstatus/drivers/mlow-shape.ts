// Is voip's second stop the dynamic import('libmlow-wasm'), or the hand-written
// interface it is cast to? This file has NO import at all. If it still refuses,
// the import is not the cause.
interface MlowEncoder {
    encode(pcm: Int16Array, options?: { readonly frameSize?: number }): Uint8Array
    free(): void
}
interface MlowModule {
    loadLibopus(): Promise<{ version: string }>
    createEncoder(options?: Record<string, unknown>): Promise<MlowEncoder>
}
let wasmReady: Promise<MlowModule> | null = null
let enc: MlowEncoder | null = null
export function reset(): void {
    wasmReady = null
    enc = null
}
console.log('reset is', typeof reset, wasmReady === null, enc === null)
