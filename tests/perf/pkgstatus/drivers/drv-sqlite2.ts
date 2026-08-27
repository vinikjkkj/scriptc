// The full store-sqlite bundle: every factory the package exposes, built and
// probed. No database is touched - the SQLite driver load sits behind the first
// await on a store method, and better-sqlite3 is a native addon.
import { createSqliteStore } from '../pkgs/store-sqlite/index'

const store = createSqliteStore({ path: ':memory:' })
const s = store.stores
const c = store.caches
console.log('1  auth          ', typeof s.auth('s1'))
console.log('2  preKey        ', typeof s.preKey('s1'))
console.log('3  session       ', typeof s.session('s1'))
console.log('4  identity      ', typeof s.identity('s1'))
console.log('5  signal        ', typeof s.signal('s1'))
console.log('6  senderKey     ', typeof s.senderKey('s1'))
console.log('7  appState      ', typeof s.appState('s1'))
console.log('8  messages      ', typeof s.messages('s1'))
console.log('9  threads       ', typeof s.threads('s1'))
console.log('10 contacts      ', typeof s.contacts('s1'))
console.log('11 privacyToken  ', typeof s.privacyToken('s1'))
console.log('12 retry         ', typeof c.retry('s1'))
console.log('13 groupMetadata ', typeof c.groupMetadata('s1'))
console.log('14 deviceList    ', typeof c.deviceList('s1'))
console.log('15 messageSecret ', typeof c.messageSecret('s1'))
console.log('16 same session id reuses', s.auth('s1') === s.auth('s1'))
console.log('17 distinct session ids differ', s.auth('a') === s.auth('b'))
