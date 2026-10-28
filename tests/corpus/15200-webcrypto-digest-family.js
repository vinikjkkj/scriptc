// globalThis.crypto.subtle.digest for SHA-1/256/384/512: the digest bytes in
// hex, the ArrayBuffer shape, Object-form algorithms, views and a digest
// result fed back in, and the rejection of an unsupported algorithm name
// (MD5 has no WebCrypto digest; Node rejects it with a NotSupportedError).
const te = new TextEncoder()
const hex = (b) => Buffer.from(b).toString('hex')
const subtle = globalThis.crypto.subtle
const names = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']
async function main() {
  for (const n of names) {
    const h = await subtle.digest(n, te.encode('abc'))
    console.log(n, h instanceof ArrayBuffer, h.byteLength, hex(h))
  }
  console.log(hex(await subtle.digest({ name: 'SHA-512' }, te.encode('abc'))))
  console.log(hex(await subtle.digest('sha-256', te.encode('abc'))))
  console.log(hex(await subtle.digest('SHA-384', new Uint8Array(0))))
  console.log(hex(await subtle.digest('SHA-384', te.encode('a'.repeat(300)))))
  const view = new Uint8Array([0, 97, 98, 99, 0]).subarray(1, 4)
  console.log(hex(await subtle.digest('SHA-1', view)))
  console.log(hex(await subtle.digest('SHA-1', new DataView(new Uint8Array([97, 98, 99]).buffer))))
  const first = await subtle.digest('SHA-1', te.encode('x'))
  console.log(hex(await subtle.digest('SHA-256', first)))
  const md5 = 'MD5'
  const bogus = 'SHA-3'
  try {
    await subtle.digest(md5, te.encode('abc'))
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  try {
    await subtle.digest(bogus, te.encode('abc'))
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
}
main().catch((e) => console.log('failed', e.name, e.message))
