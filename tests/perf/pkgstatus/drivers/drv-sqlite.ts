// A program that USES store-sqlite, rather than one that only imports its entry.
// statementsFailed=0 on an entry is a LOWER BOUND; this is what a caller hits.
import { createSqliteStore } from '../pkgs/store-sqlite/index'

const store = createSqliteStore({ path: ':memory:' })
const auth = store.stores.auth('s1')
console.log('auth store:', typeof auth)
