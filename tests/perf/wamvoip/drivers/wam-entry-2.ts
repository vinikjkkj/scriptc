// wam ENTRY driver, stage 2: the entry MINUS the plugin factory.
// Same package entry, but touching only WaWamCoordinator as a value, so
// `defineWaClientPlugin`'s intersection return type is never instantiated.
// If this builds where wam-entry-1.ts does not, the intersection is a
// separable blocker rather than a symptom.
import { WaWamCoordinator } from '../pkgs/wam/index.js'

console.log('coordinator ' + typeof WaWamCoordinator)
console.log('name ' + WaWamCoordinator.name)
