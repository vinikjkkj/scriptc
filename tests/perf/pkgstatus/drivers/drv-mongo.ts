import { createMongoStore } from '../pkgs/store-mongo/index'
const store = createMongoStore({ db: { uri: 'mongodb://127.0.0.1:27017', database: 'db' } })
console.log('stores:', typeof store.stores.auth('s1'))
