// A binding over `crypto.subtle` (module scope and function scope) serves the four lowered
// SubtleCrypto members; under @types/node 26 the same binding is typed SubtleCrypto.
const data = new TextEncoder().encode('abc')
const subtle = crypto.subtle
async function main() {
  const h = await subtle.digest('SHA-256', data)
  console.log(new Uint8Array(h).length)
  const key = await subtle.importKey('raw', data, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await subtle.sign('HMAC', key, data)
  console.log(new Uint8Array(sig).length)
  const k2 = await subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: data, iterations: 2 }, k2, 256)
  console.log(new Uint8Array(bits).length)
  const local = crypto.subtle
  console.log(new Uint8Array(await local.digest('SHA-1', data)).length)
}
main()
