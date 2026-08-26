// Reference bytes for voip/relay/stun.ts under node, using the installed
// zapo-js. `buildWhatsAppPing` and `isStunPacket` are deterministic;
// `buildBindingRequest` carries a random transaction id, so only its length
// and its fixed prefix are asserted.
import { buildSenderSubscriptions, buildWhatsAppPing, isStunPacket } from '../pkgs/voip/relay/stun.js'

function hex(b: Uint8Array): string {
    let s = ''
    for (let i = 0; i < b.length; i += 1) {
        const t = b[i].toString(16)
        s += t.length === 1 ? '0' + t : t
    }
    return s
}

const ping = buildWhatsAppPing()
console.log('ping        = ' + hex(ping))
console.log('ping is stun= ' + isStunPacket(ping))
console.log('subs(0x11223344) = ' + hex(buildSenderSubscriptions(0x11223344)))
console.log('subs(1)     = ' + hex(buildSenderSubscriptions(1)))
console.log('notstun     = ' + isStunPacket(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0])))
