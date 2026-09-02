// Probe for the boxed-instance member table against a class whose base is
// runtime-provided (`Error`). voip ships two of these for real:
//   pkgs/voip/call/call-state.ts:263  InvalidTransition extends Error
//   pkgs/voip/crypto/srtp.ts:238      SrtpError         extends Error
// The guard added in bd4bb750 denies a member table to exactly this shape,
// because without it JSON.stringify answered a plausible WRONG object at
// exit 0. This driver asks the four enumerating surfaces named in ea72d108
// (`in`, Object.keys, JSON.stringify, String) on such an instance and diffs
// the answer against node. A wrong answer here is a WRONG, not a TRAP.
import { InvalidTransition } from '../pkgs/voip/call/call-state.js'

const e = new InvalidTransition('ringing', 'accept')

console.log('1 name          =', e.name)
console.log('2 message       =', e.message)
console.log('3 currentState  =', e.currentState)
console.log('4 attempted     =', e.attempted)
console.log('5 String(e)     =', String(e))
console.log('6 keys          =', JSON.stringify(Object.keys(e)))
console.log('7 stringify     =', JSON.stringify(e))
console.log('8 in currentState =', 'currentState' in e)
console.log('9 in attempted    =', 'attempted' in e)
console.log('10 in name        =', 'name' in e)
console.log('11 in message     =', 'message' in e)
console.log('12 in nope        =', 'nope' in e)
console.log('13 instanceof Error =', e instanceof Error)
console.log('14 instanceof IT    =', e instanceof InvalidTransition)

let caught = 'NONE'
let ckeys = 'NONE'
try {
    throw new InvalidTransition('idle', 'end')
} catch (x) {
    const t = x as InvalidTransition
    caught = t.message
    ckeys = JSON.stringify(Object.keys(t))
}
console.log('15 caught message =', caught)
console.log('16 caught keys    =', ckeys)
console.log('VOIP-ERRSUB: END')
