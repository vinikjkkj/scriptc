// A generic INTERFACE method whose type parameter carries no constraint —
// zapo's `WaSqliteConnection.runInTransaction<T>`, store-sqlite's
// connection.ts:41, reached from BaseSqliteStore.ts:55/59 and
// migrations.ts:487:
//
//   type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
//   interface WaSqliteConnection {
//       runInTransaction<T>(run: () => NonPromise<T>): Promise<NonPromise<T>>
//   }
//   protected async withTransaction<T>(...): Promise<NonPromise<T>> {
//       const db = await this.getConnection()
//       return db.runInTransaction(() => run(db))     // <- refused
//   }
//
// A CONSTRAINED type parameter maps at its constraint and the member keeps
// an ordinary closure slot. A bare `<T>` had no written widest binding, so
// the member left the record shape and every call through the
// interface-typed receiver refused (SC1090) — and the receiver here comes
// out of a factory, so "bind it to a `new`" could not be followed either.
//
// The binding it does have is the union of the types the PROGRAM
// instantiates it at, computed whole-program before any shape interns. Two
// things make that the honest answer rather than a convenience:
//
//   * a union arm keeps the value's OWN representation, so identity and
//     mutation are the caller's. Erasing to `unknown` instead would be a
//     WRONG ANSWER, not a wider one: an array or record crossing the dyn
//     boundary is deep-COPIED, so `back === original` reads false where Node
//     says true and a write through the original is never seen again;
//   * a set that comes out too NARROW cannot go wrong silently — the missing
//     type simply fails to coerce into the slot, which is a refusal.
//
// This program is the zapo shape: a factory-produced interface receiver, TWO
// producing object literals (the real one and a pooled forwarder, exactly
// connection.ts:170 and :401), a filtering conditional over the parameter,
// an abstract base that forwards its OWN type parameter to the member, and
// four instantiations — an array, a record, a number and void. It asserts
// what a copy would break: reference identity out of the transaction, and a
// write through the original seen afterwards.

type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
type Task<T> = () => NonPromise<T>

interface Conn {
    run(sql: string): void
    runInTransaction<T>(task: Task<T>): Promise<NonPromise<T>>
}

/** connection.ts:170 — the real connection. */
function openConn(tag: string): Conn {
    const run = (sql: string): void => {
        console.log(tag + ' ' + sql)
    }
    return {
        run,
        async runInTransaction<T>(task: Task<T>): Promise<NonPromise<T>> {
            run('BEGIN')
            const result = task()
            run('COMMIT')
            return result
        }
    }
}

/** connection.ts:401 — the pooled wrapper, which FORWARDS to another Conn.
 * A second producer of the same slot, and the reason a single-implementation
 * devirtualization would not have been enough. */
function pooled(inner: Conn): Conn {
    return {
        run(sql: string): void {
            inner.run(sql)
        },
        runInTransaction<T>(task: Task<T>): Promise<NonPromise<T>> {
            return inner.runInTransaction(task)
        }
    }
}

interface Row {
    id: number
    name: string
}

/** BaseSqliteStore — forwards its OWN type parameter to the member, so the
 * instantiation set is not closed by the member's call sites alone. */
abstract class BaseStore {
    private conn: Conn | null = null

    protected async getConnection(): Promise<Conn> {
        if (!this.conn) {
            this.conn = pooled(openConn('sql'))
        }
        return this.conn
    }

    protected async withTransaction<T>(run: (db: Conn) => NonPromise<T>): Promise<NonPromise<T>> {
        const db = await this.getConnection()
        return db.runInTransaction(() => run(db))
    }
}

const sharedRows: number[] = [1, 2, 3]
const sharedRow: Row = { id: 1, name: 'a' }

class Store extends BaseStore {
    public async ids(): Promise<number[]> {
        return this.withTransaction<number[]>((db) => {
            db.run('SELECT id')
            return sharedRows
        })
    }

    public async one(): Promise<Row> {
        return this.withTransaction<Row>((db) => {
            db.run('SELECT row')
            return sharedRow
        })
    }

    public async count(): Promise<number> {
        return this.withTransaction<number>((db) => {
            db.run('SELECT count')
            return 7
        })
    }

    /** migrations.ts:487 — the callback returns nothing, so T is void. */
    public async migrate(): Promise<void> {
        await this.withTransaction<void>((db) => {
            db.run('INSERT migration')
        })
    }
}

async function main(): Promise<void> {
    const store = new Store()

    const ids = await store.ids()
    console.log('array identity', ids === sharedRows)
    ids.push(4)
    console.log('write through the returned array', JSON.stringify(sharedRows))
    sharedRows.push(5)
    console.log('write through the original', JSON.stringify(ids))

    const row = await store.one()
    console.log('record identity', row === sharedRow)
    sharedRow.name = 'z'
    console.log('read after a write through the original', row.name)
    row.id = 99
    console.log('read after a write through the returned record', sharedRow.id)

    console.log('count', await store.count())

    await store.migrate()
    console.log('void instantiation returned')

}

void main()
