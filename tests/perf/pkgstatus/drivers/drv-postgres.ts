import { createPostgresStore } from '../pkgs/store-postgres/index'
const store = createPostgresStore({ pool: { host: '127.0.0.1', port: 5432, user: 'u', password: 'p', database: 'db' } })
console.log('stores:', typeof store.stores.auth('s1'))
