// A/B PROBE, block wamcoord. This file is drivers/wam.ts with ONE line added:
// a direct value import of 'zapo-js'. Same shape as _x-sqlite-plus-zapo.ts:
// provenance.ts walks bare imports in DRIVER-IMPORT ORDER, so naming 'zapo-js'
// registers zapo-js@1.8.2 before @zapo-js/wam is reached, instead of letting
// 'zapo-js' resolve inside wam@0.1.1's own attested checkout.
// PREDICTION: the 69 SC1090 'commit' sites go to zero, as they do on lane F.
import { WaClient } from 'zapo-js'
import { wamPlugin, WaWamCoordinator } from '@zapo-js/wam'

const p = wamPlugin()
console.log('plugin=' + typeof p)
console.log('coordinator=' + WaWamCoordinator.name)
console.log('client=' + typeof WaClient)
