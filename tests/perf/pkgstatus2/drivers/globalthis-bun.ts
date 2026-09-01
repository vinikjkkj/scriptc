// The exact shape of zapo-js src/util/runtime.ts:20.
// `window` is deliberately NOT here: it stays fenced in a TypeScript source
// (tests/fixtures/node-types/stdlib-surfaces-fenced.ts ratifies that), and it
// is exercised in globalthis-neg4.ts instead.
export function isBunRuntime(): boolean {
    return typeof (globalThis as { readonly Bun?: unknown }).Bun !== 'undefined'
}
export function isDenoRuntime(): boolean {
    return typeof (globalThis as { readonly Deno?: unknown }).Deno !== 'undefined'
}
console.log('1 bun:', isBunRuntime())
console.log('2 deno:', isDenoRuntime())
console.log('3 bun typeof:', typeof (globalThis as { readonly Bun?: unknown }).Bun)
