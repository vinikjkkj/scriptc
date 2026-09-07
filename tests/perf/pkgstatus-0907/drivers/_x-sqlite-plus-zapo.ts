// A/B PROBE. This file is drivers/store-sqlite.ts with ONE line added: a direct
// value import of 'zapo-js'. tests/perf/zapo-rest/app182/zapo-rest.ts imports
// BOTH
//     import { WaClient, createStore } from "zapo-js"
//     import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite"
// while the lane-A driver imports only the store package. provenance.ts walks
// bare imports in DRIVER-IMPORT ORDER, value specifiers first, so a driver that
// names 'zapo-js' itself registers zapo-js@1.8.2 before the store package is
// reached -- and a driver that does not leaves 'zapo-js' to be resolved inside
// the store package's own attested v1.8.0 checkout, through that checkout's
// tsconfig paths alias `zapo-js -> src`.
//
// PREDICTION: this file reports 0 blocker sites where drivers/store-sqlite.ts
// reports 7. Nothing else differs between the two.
// pkgstatus lane-A driver, @zapo-js/store-sqlite.
// Realistic consumer shape: call the package's own factory, then take one
// store out of every domain it hands back, so the store constructors and
// their field initialisers are REACHED rather than merely named.
import { WaClient } from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'

const r = createSqliteStore({ path: ':memory:' })
const s = r.stores
const c = r.caches
console.log('auth=' + typeof s.auth('s1'))
console.log('preKey=' + typeof s.preKey('s1'))
console.log('session=' + typeof s.session('s1'))
console.log('identity=' + typeof s.identity('s1'))
console.log('signal=' + typeof s.signal('s1'))
console.log('senderKey=' + typeof s.senderKey('s1'))
console.log('appState=' + typeof s.appState('s1'))
console.log('messages=' + typeof s.messages('s1'))
console.log('threads=' + typeof s.threads('s1'))
console.log('contacts=' + typeof s.contacts('s1'))
console.log('privacyToken=' + typeof s.privacyToken('s1'))
console.log('retry=' + typeof c.retry('s1'))
console.log('groupMetadata=' + typeof c.groupMetadata('s1'))
console.log('chatMetadata=' + typeof c.chatMetadata('s1'))
console.log('deviceList=' + typeof c.deviceList('s1'))
console.log('messageSecret=' + typeof c.messageSecret('s1'))
console.log('WaClient=' + typeof WaClient)
