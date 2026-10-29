// The WebCrypto calls of the mongodb AWS SigV4 helpers (the shape of
// src/cmap/auth/aws4.ts): SHA-256 digests as hex, HMAC-SHA-256 through
// importKey('raw') with a { name } hash dictionary and sign, with a string key
// and a byte key (RFC 4231 cases 1, 2 and 6), and the SigV4 signing-key
// derivation of the AWS documentation example.
const stringToBuffer = (s) => new TextEncoder().encode(s)
const toHex = (u) => Buffer.from(u).toString('hex')

const getHexSha256 = async (str) => {
  const data = stringToBuffer(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(hashBuffer))
}

const getHmacSha256 = async (key, str) => {
  let keyData
  if (typeof key === 'string') {
    keyData = stringToBuffer(key)
  } else {
    keyData = key
  }
  const importedKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', importedKey, stringToBuffer(str))
  return new Uint8Array(signature)
}

async function main() {
  console.log('sha256(abc)', await getHexSha256('abc'))
  console.log('sha256(empty)', await getHexSha256(''))
  console.log('tc1', toHex(await getHmacSha256(new Uint8Array(20).fill(0x0b), 'Hi There')))
  console.log('tc2', toHex(await getHmacSha256('Jefe', 'what do ya want for nothing?')))
  console.log('tc6', toHex(await getHmacSha256(new Uint8Array(131).fill(0xaa), 'Test Using Larger Than Block-Size Key - Hash Key First')))
  const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
  const kDate = await getHmacSha256('AWS4' + secret, '20150830')
  const kRegion = await getHmacSha256(kDate, 'us-east-1')
  const kService = await getHmacSha256(kRegion, 'iam')
  const kSigning = await getHmacSha256(kService, 'aws4_request')
  console.log('kSigning', toHex(kSigning), kSigning.length, kSigning instanceof Uint8Array)
}
main().catch((e) => console.log('failed', e.name, e.message))
