// pkgstatus lane-F driver: the package SOURCE, taken from the zapo-js@1.8.2
// attested checkout (757a8071b819, refs/tags/v1.8.2), because this package
// publishes NO provenance attestation and therefore cannot be measured
// through its npm artifact at all. Copied to napp/pkgsrc/wam/ verbatim.
import { wamPlugin, WaWamCoordinator } from './wam/index'

const p = wamPlugin()
console.log('plugin=' + typeof p)
console.log('coordinator=' + WaWamCoordinator.name)
