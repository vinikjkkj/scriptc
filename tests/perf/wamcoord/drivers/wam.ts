// pkgstatus lane-A driver, @zapo-js/wam.
import { wamPlugin, WaWamCoordinator } from '@zapo-js/wam'

const p = wamPlugin()
console.log('plugin=' + typeof p)
console.log('coordinator=' + WaWamCoordinator.name)
