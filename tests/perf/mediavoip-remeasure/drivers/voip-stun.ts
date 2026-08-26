// Static-lane driver for voip/relay/stun.ts.
//
// Default lane: 19 statements analysed, 28 diagnostic sites, all behind the
// zapo-js island. Under --provenance-sources: 48 statements, none failed.
//
// `buildWhatsAppPing` carries a RANDOM transaction id, so only its length, its
// fixed STUN header + magic cookie prefix, and its acceptance by `isStunPacket`
// are asserted -- asserting the random tail would fail on node too, which is
// how I know these are the right assertions. `buildSenderSubscriptions` is
// deterministic and its bytes come from `drivers/voip-stun-oracle.ts` under
// node v25.9.0.
import { buildSenderSubscriptions, buildWhatsAppPing, isStunPacket } from '../pkgs/voip/relay/stun.js'

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

const ping = buildWhatsAppPing()
eq(ping.length.toString(), '20', 'buildWhatsAppPing length')
eq(hex(ping.subarray(0, 8)), '080100002112a442', 'buildWhatsAppPing header + magic cookie')
eq(isStunPacket(ping) ? 'true' : 'false', 'true', 'isStunPacket accepts it')

// The must-reject arm. Without it, `isStunPacket` returning true always would
// pass every assertion above.
eq(isStunPacket(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0])) ? 'true' : 'false',
    'false', 'isStunPacket rejects non-STUN')

// Two transaction ids in a row must differ: the id is random, and a build that
// zeroed it would still satisfy every fixed-prefix assertion above.
eq(hex(buildWhatsAppPing().subarray(8)) === hex(ping.subarray(8)) ? 'same' : 'differ',
    'differ', 'transaction id is random')

eq(hex(buildSenderSubscriptions(0x11223344)), '0a0a18c4e688890128003000', 'buildSenderSubscriptions 0x11223344')
eq(hex(buildSenderSubscriptions(1)), '0a06180128003000', 'buildSenderSubscriptions 1')

console.log(fails === 0 ? 'VOIP-STUN: ALL PASS' : 'VOIP-STUN: ' + fails + ' FAILURES')
