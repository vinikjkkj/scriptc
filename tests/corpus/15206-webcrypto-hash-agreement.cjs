// subtle.digest agrees with node:crypto's createHash for every SHA the
// WebCrypto surface names, over lengths on both sides of each block size.
// The SHA-384 column is the digest Node computes for the same bytes (the
// static createHash lowers sha1, sha256, sha512 and md5 only).
const nodeCrypto = require('crypto')
const hex = (b) => Buffer.from(b).toString('hex')
const subtle = globalThis.crypto.subtle
const sha384Node = [
  "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b", // 0
  "f12be95011fa37de81bf76bee4e73a992f431a7c69b60d2495c7383ae0545569842a0c019d89c208ae48f843562b56ff", // 1
  "c3fc2efb3f7f03957fed594638fc1a9e5b790844913e7fd43ad29a26bd5e5aaf494a137cc3f282d73e778d77d3c1c036", // 55
  "29d62ede666ed78653a8f02f92eb8a02b4b627d15f0e6d61291f63b0ec159586316fbe3f2450d01c82d86e52ae754483", // 56
  "cd8621421f3eca8f41d9d35b21009846018e276278195798fb84e46700baddd94dd0ae8e8230d1f3bac66997fb62a369", // 63
  "5a7c058de8f3c7e5eb66aca0f99b51860f936baca131c77d90de19fa1bbf7c208408b6dbe4354a9b279ef4eab09acd6e", // 64
  "5922d169e553267e1846ae2128a026407faf487dab98dfb383e751d3846f82f6edbe70b48b6202327516159d340c56a9", // 111
  "b42aff1d6d298152801480cb2b5851c32afe5e5fbae583b0a9b52fe955440c3f276fd812c0f4439cf94c3f9e03068a21", // 112
  "e0cc0da38b3a32572851d199e9e485afe1e62f5c24ac1c7f0b6680a1ea9febbe49d02923617d02074dd2ad70b5671389", // 127
  "95ab88109cbf117548a8ad35909ffefa175d06a9c42614b9d359548cff5d550b30affb36ff638cd32aa5f5409066c68a", // 128
  "1d0599fa8c2d4e8d626778051da62b78a0ecc76cbfdc5687302048373d1f8a5e772f19aeaf7be25f68e0ccf4f0b7f8a8", // 129
  "764fae9f14a568ac47cce1c42c21a3fda4ba090c1e00529a3665b0aa2ac19d1ebf6f8cacb8a141db029ab4e6dcb5806c", // 200
]
async function main() {
  const lens = [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 129, 200]
  for (let n = 0; n < lens.length; n++) {
    const len = lens[n]
    const data = new Uint8Array(len)
    for (let i = 0; i < len; i++) data[i] = (i * 31 + 7) & 255
    const pairs = [
      ['SHA-1', hex(await subtle.digest('SHA-1', data)), nodeCrypto.createHash('sha1').update(data).digest('hex')],
      ['SHA-256', hex(await subtle.digest('SHA-256', data)), nodeCrypto.createHash('sha256').update(data).digest('hex')],
      ['SHA-512', hex(await subtle.digest('SHA-512', data)), nodeCrypto.createHash('sha512').update(data).digest('hex')],
    ]
    for (const [web, got, want] of pairs) {
      console.log(len, web, got === want ? 'agree' : 'DIFFER')
    }
    const got384 = hex(await subtle.digest('SHA-384', data))
    console.log(len, 'SHA-384', got384 === sha384Node[n] ? 'agree' : 'DIFFER')
  }
}
main().catch((e) => console.log('failed', e.name, e.message))
