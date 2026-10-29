// HMAC keys imported with a { name } hash dictionary (SHA-384 and SHA-512):
// the MAC length of each, the CryptoKey a SHA-256 import yields (type, usages,
// extractable, algorithm name), the RFC 4231 test case 2 MAC, and the Node
// rejection of an unsupported usage.
const enc = new TextEncoder()
const hex = (b) => Buffer.from(b).toString('hex')
async function main() {
  for (const hash of [{ name: 'SHA-384' }, { name: 'SHA-512' }]) {
    const key = await crypto.subtle.importKey('raw', enc.encode('Jefe'), { name: 'HMAC', hash }, false, ['sign'])
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode('what do ya want for nothing?'))
    console.log(hash.name, new Uint8Array(mac).length, hex(mac).slice(0, 16))
  }
  const k = await crypto.subtle.importKey('raw', enc.encode('Jefe'), { name: 'HMAC', hash: { name: 'SHA-256' } }, true, ['sign', 'verify'])
  console.log(k.type, k.extractable, k.usages, k.algorithm.name)
  console.log(hex(await crypto.subtle.sign('HMAC', k, enc.encode('what do ya want for nothing?'))))
  try {
    await crypto.subtle.importKey('raw', enc.encode('Jefe'), { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['encrypt'])
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
}
main()
