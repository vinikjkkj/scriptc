// The shape of pg's lib/crypto/utils.js: the WebCrypto singleton is picked by
// `||` at module scope and read from functions, the SubtleCrypto is taken off
// it at load time, and the SCRAM primitives run through digest, HMAC and
// PBKDF2. The output is the hex of each primitive.
const nodeCrypto = require('crypto')
const webCrypto = nodeCrypto.webcrypto || globalThis.crypto
const subtleCrypto = webCrypto.subtle
const textEncoder = new TextEncoder()

function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomBytes(length) {
  return webCrypto.getRandomValues(Buffer.alloc(length))
}
async function sha256(text) {
  return await subtleCrypto.digest('SHA-256', text)
}
async function hashByName(hashName, text) {
  return await subtleCrypto.digest(hashName, text)
}
async function hmacSha256(keyBuffer, msg) {
  const key = await subtleCrypto.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return await subtleCrypto.sign('HMAC', key, textEncoder.encode(msg))
}
async function deriveKey(password, salt, iterations) {
  const key = await subtleCrypto.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const params = { name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iterations }
  return await subtleCrypto.deriveBits(params, key, 32 * 8, ['deriveBits'])
}
async function main() {
  console.log(hex(await sha256(textEncoder.encode('abc'))))
  console.log(hex(await hashByName('SHA-1', textEncoder.encode('abc'))))
  console.log(hex(await hmacSha256(textEncoder.encode('key'), 'The quick brown fox')))
  console.log(hex(await deriveKey('password', textEncoder.encode('salt'), 2)))
  console.log(randomBytes(8).length, typeof webCrypto)
}
main().catch((e) => console.log('failed', e.name, e.message))
