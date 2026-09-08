// A/B PROBE, block wamcoord. drivers/store-mongo.ts with ONE line added: a value
// import of 'zapo-js'. Provenance walks bare imports in DRIVER-IMPORT ORDER, so
// naming zapo-js registers 1.8.2 before the store package is reached. This is the
// lane a real consumer gets, because the plugin exists to be handed to a WaClient.
import { WaClient } from 'zapo-js'
import { createMongoStore } from '@zapo-js/store-mongo'
const r = createMongoStore({ db: { uri: 'mongodb://127.0.0.1:27017', database: 'pkgstatus' } })
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
console.log('client=' + typeof WaClient)
