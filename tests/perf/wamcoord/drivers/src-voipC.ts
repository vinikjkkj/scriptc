// pkgstatus lane-F driver: the package SOURCE, taken from the zapo-js@1.8.2
// attested checkout (757a8071b819, refs/tags/v1.8.2), because this package
// publishes NO provenance attestation and therefore cannot be measured
// through its npm artifact at all. Copied to napp/pkgsrc/voip/ verbatim.
import { voipPlugin, CallState, CallDirection, CallMediaType, EndCallReason } from './voipC/index'

const p = voipPlugin()
console.log('plugin=' + typeof p)
console.log('state=' + CallState.Ringing)
console.log('dir=' + CallDirection.Incoming)
console.log('media=' + CallMediaType.Audio)
console.log('end=' + EndCallReason.Timeout)
