// The WebCrypto singleton and its SubtleCrypto: typeof, the Object.prototype
// tags, the console.log shape of both objects, and the member arities.
const web = require('crypto').webcrypto
const subtle = globalThis.crypto.subtle
console.log(typeof web, typeof subtle, typeof web.subtle)
console.log(Object.prototype.toString.call(web), Object.prototype.toString.call(subtle))
console.log(web)
console.log(subtle)
console.log(subtle.digest.length, subtle.importKey.length, subtle.sign.length, subtle.deriveBits.length)
console.log(typeof subtle.digest, typeof web.randomUUID, typeof web.getRandomValues)
