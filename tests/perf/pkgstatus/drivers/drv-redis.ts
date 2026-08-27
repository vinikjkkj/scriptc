import { createRedisStore } from '../pkgs/store-redis/index'
const store = createRedisStore({ redis: { host: '127.0.0.1', port: 6379 } })
console.log('stores:', typeof store.stores.auth('s1'))
