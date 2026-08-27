// Does openSqliteConnection - the ONE place any store package touches its npm
// driver - reach a refusal at all? The specifier is a const binding, not a
// literal, so the default lane never fences 'better-sqlite3' anywhere.
import { openSqliteConnection } from '../pkgs/store-sqlite/connection'

async function main(): Promise<void> {
    const conn = await openSqliteConnection({ sessionId: 's1', path: ':memory:' })
    console.log('driver:', conn.driver)
    conn.exec('CREATE TABLE t (a INTEGER)')
    conn.run('INSERT INTO t (a) VALUES (?)', [7])
    const row = conn.get<{ a: number }>('SELECT a FROM t')
    console.log('row:', row === null ? 'null' : row.a)
    conn.close()
}
void main()
