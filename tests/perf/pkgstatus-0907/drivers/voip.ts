// pkgstatus lane-A driver, @zapo-js/voip.
import { voipPlugin, CallState, CallDirection, CallMediaType, EndCallReason } from '@zapo-js/voip'

const p = voipPlugin()
console.log('plugin=' + typeof p)
console.log('state=' + CallState.Ringing)
console.log('dir=' + CallDirection.Incoming)
console.log('media=' + CallMediaType.Audio)
console.log('end=' + EndCallReason.Timeout)
