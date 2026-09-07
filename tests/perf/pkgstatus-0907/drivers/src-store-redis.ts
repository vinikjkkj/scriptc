// pkgstatus lane-F/G driver: the package SOURCE taken verbatim from the
// zapo-js@1.8.2 attested checkout 757a8071b819 (refs/tags/v1.8.2).
// lib matches packages/store-redis/tsconfig.json in that tree.
import { createRedisStore } from './store-redis/index'

const r = createRedisStore({ redis: { host: '127.0.0.1', port: 6379 } })
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
