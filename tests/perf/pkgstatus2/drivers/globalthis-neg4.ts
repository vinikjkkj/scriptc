// NEGATIVE CONTROL 4: a name that IS measured absent from node's globalThis
// but is a CAPABILITY probe, not a runtime-identity one. It must keep its
// refusal in a TypeScript source -- the behaviour
// tests/fixtures/node-types/stdlib-surfaces-fenced.ts:49 ratifies.
console.log('1 window:', typeof (globalThis as { readonly window?: unknown }).window)
