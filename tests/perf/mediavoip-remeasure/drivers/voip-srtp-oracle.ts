// Produce reference bytes for voip's SRTP path under node, using the installed
// zapo-js. zapo's own crypto/__tests__/encryption.test.ts asserts round-trip
// and lengths but never names a protected packet's bytes; these do.
import { derivePerJidSrtpKey } from '../pkgs/voip/crypto/encryption.js'
import { SrtpSession } from '../pkgs/voip/crypto/srtp.js'
import { RtpHeader, RtpPacket } from '../pkgs/voip/media/rtp.js'

function hex(b: Uint8Array): string {
    let s = ''
    for (let i = 0; i < b.length; i += 1) {
        const t = b[i].toString(16)
        s += t.length === 1 ? '0' + t : t
    }
    return s
}

const callKey = new Uint8Array(32)
for (let i = 0; i < callKey.length; i += 1) callKey[i] = i
const keying = derivePerJidSrtpKey(callKey, '12345:0@lid')
console.log('masterKey  = ' + hex(keying.masterKey))
console.log('masterSalt = ' + hex(keying.masterSalt))

const k2 = new Uint8Array(32)
k2.fill(0x11)
const key2 = derivePerJidSrtpKey(k2, 'self:0@lid')
const session = new SrtpSession(key2, key2, 4, 4)
const header = new RtpHeader(120, 7, 1920, 0x11223344)
const payload = new Uint8Array([0xf8, 0xff, 0xfe, 0xab, 0xcd])
const prot = session.protect(new RtpPacket(header, payload))
console.log('protected  = ' + hex(prot))
const back = session.unprotect(prot)
console.log('roundtrip  = ' + hex(back.payload) + ' seq=' + back.header.sequenceNumber + ' ssrc=' + back.header.ssrc)

const k3 = new Uint8Array(32)
k3.fill(0x22)
const key3 = derivePerJidSrtpKey(k3, 'self:0@lid')
const s3 = new SrtpSession(key3, key3, 4, 4)
const p3 = s3.protect(new RtpPacket(new RtpHeader(120, 9, 1920, 0x55667788), new Uint8Array([1, 2, 3, 4])))
const tampered = p3.slice()
tampered[12] ^= 0x80
try {
    s3.unprotect(tampered)
    console.log('tamper     = NOT REJECTED')
} catch (e) {
    console.log('tamper     = rejected: ' + (e as Error).message)
}
