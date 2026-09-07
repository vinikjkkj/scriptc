// A/B PROBE, block wamcoord. drivers/voip.ts with ONE line added: a value
// import of 'zapo-js'. Same shape as _x-wam-plus-zapo.ts and pkgstatus's
// _x-sqlite-plus-zapo.ts -- provenance walks bare imports in DRIVER-IMPORT
// ORDER, so naming zapo-js registers 1.8.2 before @zapo-js/voip is reached.
// PREDICTION: no change, because @zapo-js/voip publishes NO attestation, so
// the lane cannot reach its source whatever wins the alias table. Measured
// rather than assumed, because that is the fact the wam lane table turned on.
import { WaClient } from 'zapo-js'
import { voipPlugin, CallState, CallDirection, CallMediaType, EndCallReason } from '@zapo-js/voip'

const p = voipPlugin()
console.log('plugin=' + typeof p)
console.log('state=' + CallState.Ringing)
console.log('dir=' + CallDirection.Incoming)
console.log('media=' + CallMediaType.Audio)
console.log('end=' + EndCallReason.Timeout)
console.log('client=' + typeof WaClient)
