import { createMysqlStore } from '../pkgs/store-mysql/index'
const store = createMysqlStore({ pool: { host: '127.0.0.1', port: 3306, user: 'u', password: 'p', database: 'db' } })
console.log('stores:', typeof store.stores.auth('s1'))
