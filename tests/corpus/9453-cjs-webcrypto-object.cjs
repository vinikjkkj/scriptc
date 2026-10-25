// globalThis.crypto is the WebCrypto object: typeof "object", one process
// singleton (identity holds across the bare, property and require spellings),
// and its randomness methods work. Output is shape-only, so it is deterministic.
const viaRequire = require('crypto').webcrypto
console.log(typeof globalThis.crypto)
console.log(typeof viaRequire)
console.log(globalThis.crypto === globalThis.crypto)
console.log(viaRequire === globalThis.crypto ? 'same' : 'different')
console.log(typeof globalThis.crypto.getRandomValues, typeof globalThis.crypto.randomUUID)
const bytes = new Uint8Array(8)
const back = globalThis.crypto.getRandomValues(bytes)
console.log(back.length, bytes.length)
console.log(globalThis.crypto.randomUUID().length)
try {
  globalThis.crypto.getRandomValues(null)
} catch (e) {
  console.log(e.message)
}
