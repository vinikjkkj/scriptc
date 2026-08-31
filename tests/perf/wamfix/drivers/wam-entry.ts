// Driver for wam's PACKAGE ENTRY.
//
// The first import is `pkgs/wam/index.ts` -- the entry itself -- so the whole
// wam module graph (plugin, coordinator, auto-emitter, uploader, globals,
// registry, synthetic, wire) enters the program. The later imports are
// observables on modules the entry ALREADY pulls in; they add no module to the
// graph, they only give the binary something an oracle can disagree with.
//
// PROVENANCE SKEW: the attested @vinikjkkj/wa-wam tree is one generation
// behind the published artifact -- 49 additive lines. Every table this driver
// reads is identical in both trees. It stays clear of the enums
// BANNER_TYPES, MEDIA_PICKER_ORIGIN_TYPE, MEDIA_TYPE, PAYMENT_ACTION_TARGETS,
// PTT_MESSAGE_USER_JOURNEY_ACTION, PTT_MESSAGE_USER_JOURNEY_STAGE,
// SURFACE_TYPE and CA2D_EXTENSION_CONNECTION_STATE, and of the events Call and
// MessageSend.
import { WaWamCoordinator, wamPlugin } from '../pkgs/wam/index.js'

import { resolveWamGlobals } from '../pkgs/wam/globals.js'
import { resolveWamEnumValue, resolveWamEventFields, wamValueKind } from '../pkgs/wam/registry.js'

let fails = 0
function eq(actual: string, expected: string, label: string): void {
    if (actual !== expected) {
        fails += 1
        console.log('FAIL ' + label + ': got ' + actual + ' want ' + expected)
    } else {
        console.log('ok   ' + label + ' = ' + actual)
    }
}

// --- the entry's own exports -------------------------------------------
const plugin = wamPlugin({ autoEmit: false, syntheticUi: false })
eq(plugin.id, '@zapo-js/wam', 'plugin id')
eq(String(plugin.exposeAs), 'wam', 'plugin exposeAs')
eq(typeof plugin.setup, 'function', 'plugin setup is callable')
eq(typeof plugin.dispose, 'function', 'plugin dispose is callable')
eq(WaWamCoordinator.name, 'WaWamCoordinator', 'coordinator class name')

// --- registry: enum resolution -----------------------------------------
eq(String(resolveWamEnumValue('UI_ACTION_TYPE', 'CHAT_OPEN')), '3', 'enum UI_ACTION_TYPE.CHAT_OPEN')
eq(String(resolveWamEnumValue('SIZE_BUCKET', 'LT128')), '3', 'enum SIZE_BUCKET.LT128')
eq(String(resolveWamEnumValue('UI_ACTION_TYPE', 'NO_SUCH_KEY')), 'null', 'enum unknown key is null')

// --- registry: type -> wire kind ---------------------------------------
eq(String(wamValueKind('boolean')), 'bool', 'kind boolean')
eq(String(wamValueKind('integer')), 'int', 'kind integer')
eq(String(wamValueKind('timer')), 'int', 'kind timer')
eq(String(wamValueKind('enum')), 'int', 'kind enum')
eq(String(wamValueKind('number')), 'float', 'kind number')
eq(String(wamValueKind('string')), 'string', 'kind string')
eq(String(wamValueKind('unknown')), 'null', 'kind unknown')

// --- registry: a whole event payload, in declaration order --------------
function fmtFields(fs: readonly { id: number; kind: string; value: number | string | boolean }[]): string {
    let s = ''
    for (let i = 0; i < fs.length; i += 1) {
        if (i > 0) s += ','
        s += String(fs[i].id) + ':' + fs[i].kind + '=' + String(fs[i].value)
    }
    return s
}
const uiFields = resolveWamEventFields('UiAction', {
    uiActionType: 'CHAT_OPEN',
    uiActionT: 142,
    deviceCount: 2,
    isLid: true,
    appContext: 'chatlist'
})
eq(fmtFields(uiFields), '21:string=chatlist,5:int=2,8:bool=true,3:int=142,1:int=3', 'UiAction resolved fields')

const dropped = resolveWamEventFields('UiAction', { uiActionType: 'NO_SUCH_KEY', deviceCount: 7 })
eq(fmtFields(dropped), '5:int=7', 'unresolvable enum field is dropped')

const empty = resolveWamEventFields('UiAction', {})
eq(String(empty.length), '0', 'empty payload resolves to no fields')

// --- globals: the id-keyed map a batch header carries -------------------
function fmtGlobals(m: ReadonlyMap<number, number | string | boolean | null>): string {
    const ids: number[] = []
    for (const id of m.keys()) ids[ids.length] = id
    ids.sort((a, b) => a - b)
    let s = ''
    for (let i = 0; i < ids.length; i += 1) {
        if (i > 0) s += ','
        s += String(ids[i]) + '=' + String(m.get(ids[i]))
    }
    return s
}
const globals = resolveWamGlobals(
    {
        deviceBrowser: 'Chrome',
        deviceOsDisplayName: 'Windows',
        devicePlatform: 'WEB',
        streamId: 7,
        appVersion: '2.3000.0',
        serviceImprovementOptOut: false
    },
    'regular'
)
console.log('globals regular = ' + fmtGlobals(globals))

const privateGlobals = resolveWamGlobals(
    {
        deviceBrowser: 'Chrome',
        deviceOsDisplayName: 'Windows',
        devicePlatform: 'WEB',
        streamId: 7,
        appVersion: '2.3000.0',
        serviceImprovementOptOut: false
    },
    'private'
)
eq(
    globals.size > privateGlobals.size ? 'fewer' : 'not-fewer',
    'fewer',
    'the private channel carries fewer globals than regular'
)

console.log(fails === 0 ? 'WAM-ENTRY: ALL PASS' : 'WAM-ENTRY: ' + fails + ' FAILURES')
