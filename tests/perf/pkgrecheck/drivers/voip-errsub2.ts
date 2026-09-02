// FLAGLESS voip driver. `InvalidTransition extends Error` (voip's own class,
// pkgs/voip/call/call-state.ts:263) is a class whose chain reaches a
// runtime-provided base, so the guard from bd4bb750 denies it a dyn member
// table. This driver asks ONLY the surfaces that guard leaves reachable --
// .message, .name, String(), instanceof, and a plain member read -- and diffs
// them against node. The four enumerating surfaces it REFUSES are measured
// separately in drivers/voip-errsub.ts, where they fail the build by name.
//
// CallInfo is deliberately not constructed: its private constructor reaches
// `new Date()` (call-state.ts:55), which has no lowering, so any driver that
// builds a CallInfo cannot build flagless.
import { InvalidTransition } from '../pkgs/voip/call/call-state.js'

let n = 0
function show(label: string, v: string): void {
    n += 1
    console.log(n + ' ' + label + ' = ' + v)
}

const e = new InvalidTransition('ringing', 'accept')
show('name', e.name)
show('message', e.message)
show('currentState', e.currentState)
show('attempted', e.attempted)
show('String(e)', String(e))
show('template', `${e}`)
show('instanceof Error', e instanceof Error ? 'true' : 'false')
show('instanceof InvalidTransition', e instanceof InvalidTransition ? 'true' : 'false')
show('typeof', typeof e)
show('message length', String(e.message.length))
show('message slice', e.message.slice(0, 18))

const e2 = new InvalidTransition('connecting', 'offer_sent')
show('second message', e2.message)
show('second currentState', e2.currentState)
show('distinct instances', e.currentState === e2.currentState ? 'same' : 'different')

let caught = 'NO THROW'
let cname = 'NO THROW'
let cstate = 'NO THROW'
let isSub = 'false'
try {
    throw new InvalidTransition('idle', 'end')
} catch (x) {
    const t = x as InvalidTransition
    caught = t.message
    cname = t.name
    cstate = t.currentState
    isSub = t instanceof InvalidTransition ? 'true' : 'false'
}
show('caught message', caught)
show('caught name', cname)
show('caught currentState', cstate)
show('caught instanceof', isSub)

console.log('VOIP-ERRSUB2: END')
