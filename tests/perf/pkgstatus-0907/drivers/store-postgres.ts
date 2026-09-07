// pkgstatus lane-A driver, @zapo-js/store-postgres.
// Realistic consumer shape: call the package's own factory, then take one
// store out of every domain it hands back, so the store constructors and
// their field initialisers are REACHED rather than merely named.
import { createPostgresStore } from '@zapo-js/store-postgres'

const r = createPostgresStore({ pool: { host: '127.0.0.1', database: 'pkgstatus' } })
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
