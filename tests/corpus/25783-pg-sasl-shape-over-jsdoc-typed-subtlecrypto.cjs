// pg's lib/crypto/utils.js + sasl.js shape: the WebCrypto singleton and its SubtleCrypto carry
// JSDoc `@type Crypto` / `@type SubtleCrypto` (typed by @types/node 26, which declares the
// global interfaces; any under 24), the digest answer is an ArrayBuffer fed to Buffer.from, and
// the SCRAM-PLUS channel-binding data is a Buffer.concat of two Buffer.from.
const nodeCrypto = require('crypto')
/**
 * @type Crypto
 */
const webCrypto = nodeCrypto.webcrypto || globalThis.crypto
/**
 * @type SubtleCrypto
 */
const subtleCrypto = webCrypto.subtle
const textEncoder = new TextEncoder()

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
function xorBuffers(a, b) {
  return Buffer.from(a.map((_, i) => a[i] ^ b[i]))
}
async function main() {
  const certHash = await hashByName('SHA-256', Buffer.from('peer-certificate'))
  const bindingData = Buffer.concat([Buffer.from('p=tls-server-end-point,,'), Buffer.from(certHash)])
  console.log(bindingData.toString('base64'))
  const clientKey = await hmacSha256(Buffer.from('salted'), 'Client Key')
  const clientSignature = await hmacSha256(Buffer.from('stored'), 'auth message')
  console.log(xorBuffers(Buffer.from(clientKey), Buffer.from(clientSignature)).toString('base64'))
  console.log(Buffer.from(await deriveKey('pw', Buffer.from('salt'), 4)).toString('hex'))
}
main().catch((e) => console.log('failed', e.name, e.message))
