// subtle.importKey('raw') for HMAC keys and subtle.sign('HMAC'): the MAC bytes
// for SHA-1/256/384/512, a key longer than the hash block, the CryptoKey
// shape as console.log prints it, and the usage and key-kind refusals.
const te = new TextEncoder()
const hex = (b) => Buffer.from(b).toString('hex')
const subtle = globalThis.crypto.subtle
async function main() {
  const k1 = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  console.log('SHA-1', hex(await subtle.sign('HMAC', k1, te.encode('The quick brown fox'))))
  const k256b = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  console.log('SHA-256', hex(await subtle.sign('HMAC', k256b, te.encode('The quick brown fox'))))
  const k384 = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-384' }, false, ['sign'])
  console.log('SHA-384', hex(await subtle.sign('HMAC', k384, te.encode('The quick brown fox'))))
  const k512b = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  console.log('SHA-512', hex(await subtle.sign('HMAC', k512b, te.encode('The quick brown fox'))))
  const longKey = await subtle.importKey('raw', new Uint8Array(200).fill(9), { name: 'HMAC', hash: 'SHA-384' }, false, ['sign'])
  console.log('long', hex(await subtle.sign({ name: 'HMAC' }, longKey, te.encode('msg'))))
  const k = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-512' }, true, ['sign', 'verify'])
  console.log(k)
  console.log(k.type, k.extractable, k.usages, k.algorithm.name, k.algorithm.length, k.algorithm.hash.name)
  const k256 = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  console.log(k256)
  try {
    await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['encrypt'])
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  try {
    await subtle.importKey('raw', new Uint8Array(0), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  try {
    await subtle.sign('HMAC', k256, te.encode('x'))
    console.log('signed')
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  const noSign = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  try {
    await subtle.sign('HMAC', noSign, te.encode('x'))
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
}
main().catch((e) => console.log('failed', e.name, e.message))
