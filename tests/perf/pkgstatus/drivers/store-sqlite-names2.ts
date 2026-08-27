// The subset of store-sqlite/table-names.ts + sql-utils.ts that compiles today:
// the default table-name map, its serialization, and the SQL token repeater.
// resolveSqliteTableNames WITH overrides is excluded on purpose - it reaches
// normalizeTableName (RegExp.toString) and Object.freeze of an aliased record.
import { resolveSqliteTableNames, serializeSqliteTableNames } from '../pkgs/store-sqlite/table-names'
import { repeatSqlToken } from '../pkgs/store-sqlite/sql-utils'

const defaults = resolveSqliteTableNames()
console.log('1', defaults.auth_credentials)
console.log('2', defaults.mailbox_messages)
console.log('3', defaults.appstate_collection_index_values)
console.log('4', serializeSqliteTableNames(defaults))
console.log('5', repeatSqlToken('?', 4, ', '))
console.log('6', repeatSqlToken('?', 1, ', '))
console.log('7', JSON.stringify(repeatSqlToken('?', 0, ', ')))
console.log('8', repeatSqlToken('(?, ?)', 3, ' UNION ALL '))
