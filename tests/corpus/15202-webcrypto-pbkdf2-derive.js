// subtle.importKey('raw') for a PBKDF2 base key and subtle.deriveBits: the
// derived bytes for SHA-1/256/384/512 across iteration counts, the base key
// shape, and the OperationError, InvalidAccessError and SyntaxError paths.
const te = new TextEncoder()
const hex = (b) => Buffer.from(b).toString('hex')
const subtle = globalThis.crypto.subtle
async function main() {
  const pk = await subtle.importKey('raw', te.encode('password'), 'PBKDF2', false, ['deriveBits'])
  console.log(pk)
  console.log(pk.type, pk.extractable, pk.usages, pk.algorithm.name)
  const salt = te.encode('salt')
  console.log('SHA-1', hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-1', salt, iterations: 2 }, pk, 160)))
  console.log('SHA-256', hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 2 }, pk, 256)))
  console.log('SHA-384', hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-384', salt, iterations: 2 }, pk, 384)))
  console.log('SHA-512', hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations: 2 }, pk, 512)))
  console.log('SHA3-256', hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA3-256', salt, iterations: 2 }, pk, 256)))
  console.log(hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations: 4096 }, pk, 512)))
  console.log(hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 2 }, pk, 100 + 60)))
  console.log((await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, pk, 0)).byteLength)
  const hmacKey = await subtle.importKey('raw', te.encode('key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const tries = [
    () => subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 0 }, pk, 256),
    () => subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, pk, 7),
    () => subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, pk, null),
    () => subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, hmacKey, 256),
    () => subtle.importKey('raw', te.encode('p'), 'PBKDF2', true, ['deriveBits']),
    () => subtle.importKey('raw', te.encode('p'), 'PBKDF2', false, ['sign']),
  ]
  for (const t of tries) {
    try {
      await t()
      console.log('ok')
    } catch (e) {
      console.log(e.name, e.code, e.message)
    }
  }
}
main().catch((e) => console.log('failed', e.name, e.message))
