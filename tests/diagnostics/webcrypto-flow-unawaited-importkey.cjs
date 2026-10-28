// A SubtleCrypto.importKey promise that is not awaited: the CryptoKey it carries escapes.
const s = require('crypto').webcrypto.subtle
const p = s.importKey('raw', new Uint8Array(3), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
p.then((k) => console.log(k))
