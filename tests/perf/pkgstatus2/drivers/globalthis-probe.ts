export function isBunRuntime(): boolean {
    return typeof (globalThis as { readonly Bun?: unknown }).Bun !== 'undefined'
}
console.log('bun:', isBunRuntime())
