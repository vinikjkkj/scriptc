// Buffer.from over the ArrayBuffer a digest answers: a view sharing the storage (a write through
// the Buffer is seen through a second view), the offset/length forms, the bounds RangeErrors.
const data = new TextEncoder().encode('abc')
async function main() {
  const h = await crypto.subtle.digest('SHA-256', data)
  const b = Buffer.from(h)
  console.log(b.length, b.toString('hex'))
  const mid = Buffer.from(h, 4, 8)
  console.log(mid.length, mid.toString('hex'))
  mid[0] = 0xff
  console.log(b[4], new Uint8Array(h)[4])
  console.log(Buffer.concat([Buffer.from('p=tls,,'), Buffer.from(h)]).toString('base64'))
  for (const [off, len] of [[40, 1], [1, 99]]) {
    try { Buffer.from(h, off, len) } catch (e) { console.log(e.name, e.code, e.message) }
  }
}
main()
