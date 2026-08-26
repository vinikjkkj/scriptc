// wam ENTRY driver, stage 1: does @zapo-js/wam's PACKAGE ENTRY compile?
//
// Imports only what `packages/wam/src/index.ts` exports as VALUES —
// `wamPlugin` and `WaWamCoordinator` — so the whole entry graph
// (index -> plugin -> WaWamCoordinator -> globals/registry/synthetic/
// auto-emitter/uploader/wire) has to lower for this to build at all.
//
// Every line printed here is deterministic: no Math.random, no Date.now,
// no clock. The oracle is the SAME file under node v25.9.0.
import { wamPlugin, WaWamCoordinator } from '../pkgs/wam/index.js'

const plugin = wamPlugin({ autoEmit: false, syntheticUi: false })

console.log('id ' + plugin.id)
console.log('exposeAs ' + plugin.exposeAs)
console.log('setup ' + typeof plugin.setup)
console.log('dispose ' + typeof plugin.dispose)
console.log('coordinator ' + typeof WaWamCoordinator)
