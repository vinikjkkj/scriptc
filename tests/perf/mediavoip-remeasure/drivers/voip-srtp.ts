// Static-lane driver for voip's SRTP path: crypto/encryption.ts,
// crypto/srtp.ts and media/rtp.ts together.
//
// In the default lane all three are behind the zapo-js island:
// encryption.ts analyses 0 statements, srtp.ts 16, rtp.ts 14. Under
// --provenance-sources they analyse 303, 45 and 43 with none failed.
//
// The expected bytes come from `drivers/voip-srtp-oracle.ts`, the same three
// modules run under node v25.9.0 against the installed zapo-js. zapo's own
// crypto/__tests__/encryption.test.ts asserts lengths and a round-trip but
// never names a protected packet's bytes.
import { derivePerJidSrtpKey } from '../pkgs/voip/crypto/encryption.js'
import { SrtpSession } from '../pkgs/voip/crypto/srtp.js'
import { RtpHeader, RtpPacket } from '../pkgs/voip/media/rtp.js'

let fails = 0
function eq(actual: string, expected: string, label: string): void {
    if (actual !== expected) {
        fails += 1
        console.log('FAIL ' + label + ': got ' + actual + ' want ' + expected)
    } else {
        console.log('ok   ' + label + ' = ' + actual)
    }
}

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
eq(hex(keying.masterKey), '98910a45765c741d6d0105bbafd8d24c', 'derivePerJidSrtpKey masterKey')
eq(hex(keying.masterSalt), '0ceca9ba0c214ecfe106f90f3716', 'derivePerJidSrtpKey masterSalt')

const k2 = new Uint8Array(32)
k2.fill(0x11)
const key2 = derivePerJidSrtpKey(k2, 'self:0@lid')
const session = new SrtpSession(key2, key2, 4, 4)
const payload = new Uint8Array([0xf8, 0xff, 0xfe, 0xab, 0xcd])
const prot = session.protect(new RtpPacket(new RtpHeader(120, 7, 1920, 0x11223344), payload))
eq(hex(prot), '807800070000078011223344519081bf09c22f7890', 'SrtpSession.protect bytes')

const back = session.unprotect(prot)
eq(hex(back.payload), 'f8fffeabcd', 'SrtpSession.unprotect payload')
eq(back.header.sequenceNumber.toString(), '7', 'unprotect sequenceNumber')
eq(back.header.ssrc.toString(), '287454020', 'unprotect ssrc')

// The tamper arm: unprotect must REJECT a flipped bit. A driver that only
// checked the happy path would pass with authentication removed entirely.
const k3 = new Uint8Array(32)
k3.fill(0x22)
const key3 = derivePerJidSrtpKey(k3, 'self:0@lid')
const s3 = new SrtpSession(key3, key3, 4, 4)
const p3 = s3.protect(new RtpPacket(new RtpHeader(120, 9, 1920, 0x55667788), new Uint8Array([1, 2, 3, 4])))
const tampered = p3.slice()
tampered[12] ^= 0x80
let rejected = 'NOT REJECTED'
try {
    s3.unprotect(tampered)
} catch (e) {
    rejected = 'rejected'
}
eq(rejected, 'rejected', 'unprotect rejects a tampered packet')

console.log(fails === 0 ? 'VOIP-SRTP: ALL PASS' : 'VOIP-SRTP: ' + fails + ' FAILURES')
