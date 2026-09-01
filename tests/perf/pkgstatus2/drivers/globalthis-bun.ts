// The exact shape of zapo-js src/util/runtime.ts:20, plus the negative
// controls that must NOT fold: node v25.9.0 HAS fetch and navigator.
export function isBunRuntime(): boolean {
    return typeof (globalThis as { readonly Bun?: unknown }).Bun !== 'undefined'
}
export function isDenoRuntime(): boolean {
    return typeof (globalThis as { readonly Deno?: unknown }).Deno !== 'undefined'
}
console.log('1 bun:', isBunRuntime())
console.log('2 deno:', isDenoRuntime())
console.log('3 bun typeof:', typeof (globalThis as { readonly Bun?: unknown }).Bun)
console.log('4 window:', typeof (globalThis as { readonly window?: unknown }).window)
