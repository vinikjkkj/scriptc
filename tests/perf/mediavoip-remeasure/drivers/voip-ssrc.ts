// Static-lane driver for voip/crypto/ssrc.ts.
//
// zapo's own `crypto/__tests__/ssrc.test.ts` only asserts that
// `generateSecureSsrc` is deterministic and that a different counter gives a
// different answer -- it never names a value. These five expected numbers were
// produced by running the SAME module under node v25.9.0 against the installed
// zapo-js (`drivers/voip-ssrc-oracle.ts`), so this is a stricter oracle than
// the package ships.
//
// In the default lane this module is an island: 0 statements analysed. Under
// --provenance-sources it analyses 303 with none failed.
import { generateSecureSsrc } from '../pkgs/voip/crypto/ssrc.js'

let fails = 0
function eq(actual: number, expected: number, label: string): void {
    if (actual !== expected) {
        fails += 1
        console.log('FAIL ' + label + ': got ' + actual + ' want ' + expected)
    } else {
        console.log('ok   ' + label + ' = ' + actual)
    }
}

eq(generateSecureSsrc('CALLID1234567890', '12345@lid', 0), 2332697488, 'counter 0')
eq(generateSecureSsrc('CALLID1234567890', '12345@lid', 1), 2008900944, 'counter 1')
eq(generateSecureSsrc('CALLID1234567890', '12345@lid', 2), 2689934163, 'counter 2')
eq(generateSecureSsrc('OTHERCALLID00001', '12345@lid', 0), 316901375, 'other call id')
eq(generateSecureSsrc('CALLID1234567890', '99999@lid', 0), 3154953451, 'other jid')

// Determinism, the assertion zapo's own test makes.
const a = generateSecureSsrc('CALLID1234567890', '12345@lid', 0)
const b = generateSecureSsrc('CALLID1234567890', '12345@lid', 0)
eq(a === b ? 1 : 0, 1, 'deterministic for fixed inputs')

console.log(fails === 0 ? 'VOIP-SSRC: ALL PASS' : 'VOIP-SSRC: ' + fails + ' FAILURES')
