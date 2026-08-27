// store-sqlite/sql-utils.ts: the one module of any zapo store package with no
// import at all. Oracle: the same module under node v25.9.0.
import { repeatSqlToken } from '../pkgs/store-sqlite/sql-utils'

console.log('1', repeatSqlToken('?', 4, ', '))
console.log('2', repeatSqlToken('?', 1, ', '))
console.log('3', JSON.stringify(repeatSqlToken('?', 0, ', ')))
console.log('4', repeatSqlToken('(?, ?)', 3, ' UNION ALL '))
console.log('5', repeatSqlToken('?', 2, ''))
console.log('6', repeatSqlToken('x', 10, '|'))
console.log('7', JSON.stringify(repeatSqlToken('', 3, ',')))
