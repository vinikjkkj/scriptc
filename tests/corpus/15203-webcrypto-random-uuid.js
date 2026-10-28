// globalThis.crypto.getRandomValues and randomUUID: the in-place fill returns
// the same typed array, the integer-typed-array and length refusals name
// Node's DOMException (name and code), and randomUUID is an RFC 4122 v4 text.
const web = globalThis.crypto
async function main() {
  const bytes = new Uint8Array(16)
  console.log(web.getRandomValues(bytes).length, bytes.length)
  console.log(web.getRandomValues(new Uint32Array(3)).length, web.getRandomValues(new Uint8Array(0)).length)
  console.log(web.getRandomValues(new Uint8Array(65536)).length)
  console.log(web.getRandomValues(Buffer.alloc(8)).length)
  try {
    web.getRandomValues(new Uint8Array(65537))
  } catch (e) {
    console.log(e.name, e.code, e.message, e instanceof DOMException)
  }
  try {
    web.getRandomValues(new Float32Array(2))
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  try {
    web.getRandomValues(new DataView(new Uint8Array(4).buffer))
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  try {
    web.getRandomValues(null)
  } catch (e) {
    console.log(e.name, e.message)
  }
  try {
    web.getRandomValues()
  } catch (e) {
    console.log(e.name, e.code, e.message)
  }
  const uuid = web.randomUUID()
  console.log(uuid.length, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid))
  console.log(web.randomUUID() !== web.randomUUID())
  console.log(typeof web.subtle, typeof web.subtle.digest, typeof web.getRandomValues)
}
main().catch((e) => console.log('failed', e.name, e.message))
