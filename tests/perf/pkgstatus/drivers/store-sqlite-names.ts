// The first driver over a zapo store package that reaches no islanded module.
// store-sqlite/table-names.ts + sql-utils.ts import only './types' (type-only),
// so neither the zapo-js island nor better-sqlite3 is on this path.
import {
    createSqliteTableNameSqlResolver,
    resolveSqliteTableNames,
    serializeSqliteTableNames
} from '../pkgs/store-sqlite/table-names'
import { repeatSqlToken } from '../pkgs/store-sqlite/sql-utils'

const defaults = resolveSqliteTableNames()
console.log('1 default auth_credentials:', defaults.auth_credentials)
console.log('2 default serialized head:', serializeSqliteTableNames(defaults).slice(0, 60))

const overridden = resolveSqliteTableNames({ mailbox_messages: 'zz_msgs', signal_session: 'zz_sess' })
console.log('3 override mailbox_messages:', overridden.mailbox_messages)
console.log('4 override signal_session:', overridden.signal_session)
console.log('5 override untouched auth:', overridden.auth_credentials)

const idResolver = createSqliteTableNameSqlResolver(defaults)
console.log('6 identity resolver:', idResolver('SELECT * FROM mailbox_messages WHERE id = ?'))

const resolver = createSqliteTableNameSqlResolver(overridden)
console.log('7 rewrite:', resolver('SELECT * FROM mailbox_messages JOIN signal_session ON 1'))
console.log('8 no-match:', resolver('SELECT * FROM other_table'))

console.log('9 repeat:', repeatSqlToken('?', 4, ', '))
console.log('10 repeat 1:', repeatSqlToken('?', 1, ', '))
console.log('11 repeat 0:', JSON.stringify(repeatSqlToken('?', 0, ', ')))

let threw = 'no'
try {
    resolveSqliteTableNames({ not_a_table: 'x' } as never)
} catch (e) {
    threw = (e as Error).message.slice(0, 40)
}
console.log('12 bad key throws:', threw)
