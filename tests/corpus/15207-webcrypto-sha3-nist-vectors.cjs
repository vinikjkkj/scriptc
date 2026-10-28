// SHA3-256, SHA3-384 and SHA3-512 through globalThis.crypto.subtle.digest, on the
// FIPS 202 example messages: the empty string, "abc", and 200 bytes of 0xa3. Each
// digest is compared with the published value; a mismatch prints the digest we got.
// Node prints its ExperimentalWarning once per SHA-3 name on stderr; so do we.
const subtle = globalThis.crypto.subtle
const hex = (b) => Buffer.from(b).toString('hex')
const vectors = [
  ['SHA3-256', '', 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'],
  ['SHA3-256', 'abc', '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'],
  ['SHA3-256', 'a3x200', '79f38adec5c20307a98ef76e8324afbfd46cfd81b22e3973c65fa1bd9de31787'],
  ['SHA3-384', '', '0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004'],
  ['SHA3-384', 'abc', 'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25'],
  ['SHA3-384', 'a3x200', '1881de2ca7e41ef95dc4732b8f5f002b189cc1e42b74168ed1732649ce1dbcdd76197a31fd55ee989f2d7050dd473e8f'],
  ['SHA3-512', '', 'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26'],
  ['SHA3-512', 'abc', 'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0'],
  ['SHA3-512', 'a3x200', 'e76dfad22084a8b1467fcf2ffa58361bec7628edf5f3fdc0e4805dc48caeeca81b7c13c30adf52a3659584739a2df46be589c51ca1a4a8416df6545a1ce8ba00'],
]
function message(tag) {
  if (tag === '') return new Uint8Array(0)
  if (tag === 'abc') return new TextEncoder().encode('abc')
  const m = new Uint8Array(200)
  for (let i = 0; i < 200; i++) m[i] = 0xa3
  return m
}
async function main() {
  for (const [alg, tag, want] of vectors) {
    const got = hex(await subtle.digest(alg, message(tag)))
    console.log(alg, tag === 'a3x200' ? '200 x 0xa3' : JSON.stringify(tag), got === want ? 'match' : 'MISMATCH ' + got)
  }
}
main().catch((e) => console.log('failed', e.name, e.message))
