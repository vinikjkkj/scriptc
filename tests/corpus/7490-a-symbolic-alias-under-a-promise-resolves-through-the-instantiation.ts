// A conditional alias over a bare type parameter that the signature only
// ever mentions INSIDE a wrapper -- zapo's `BaseSqliteStore.withTransaction`,
// store-sqlite's BaseSqliteStore.ts:50-55:
//
//   type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
//   protected async withTransaction<T>(
//       run: (connection: WaSqliteConnection) => NonPromise<T>
//   ): Promise<NonPromise<T>> {
//       const db = await this.getConnection()
//       return db.runInTransaction(() => run(db))     // <- refused, SC2001
//   }
//
// The checker keeps `NonPromise<T>` symbolic inside the body, and the
// instantiation side table (collectSymbolicResolutions) is what carries the
// call site's resolved answer down. The table pairs the DECLARED parameter
// and return type nodes against the RESOLVED signature's, and it descended
// by property NAME only -- so it found `NonPromise<T>` when it was written
// BARE (a sync `withTransaction` returning `NonPromise<T>`), and found
// nothing at all once the same type sat under a wrapper: the properties of
// `Promise<NonPromise<T>>` are then/catch/finally, and none of them is
// `NonPromise<T>`. Making the function `async` was the whole difference
// between a program that compiled and one that refused.
//
// The table now also descends type ARGUMENTS of a matching alias or
// reference and the single call signature of a function type -- the moves
// unifySignatureBindings already makes on the binding side, and safe for
// the same reason: instantiation preserves aliasSymbol/aliasTypeArguments
// and the reference target, so the two argument lists are parallel by
// construction. Every resolution it learns is still folded into the
// instance KEY, so one instantiation can never answer for another.
//
// Nothing here is erased to `unknown`. That would be a WRONG ANSWER, not a
// wider one: an array or record crossing the dyn boundary is deep-COPIED,
// so `back === original` reads false where Node says true and a write
// through the original is never seen again. This program asserts exactly
// that -- reference identity out of the transaction, and writes visible in
// both directions afterwards.
//
// Every call site below infers its type argument. 7430 is the same zapo
// shape with the type arguments written OUT, which is the path that already
// worked (explicit type arguments bind directly in inferTypeParamBindings).

type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
type Task<T> = () => NonPromise<T>

interface Conn {
    run(sql: string): void
    runInTransaction<T>(task: Task<T>): Promise<NonPromise<T>>
}

const log: string[] = []

function openConn(tag: string): Conn {
    const run = (sql: string): void => {
        log.push(tag + ' ' + sql)
    }
    return {
        run,
        async runInTransaction<T>(task: Task<T>): Promise<NonPromise<T>> {
            run('BEGIN')
            const result: NonPromise<T> = task()
            run('COMMIT')
            return result
        }
    }
}

interface Row {
    id: number
    name: string
}

abstract class BaseStore {
    private conn: Conn | null = null

    protected async getConnection(): Promise<Conn> {
        if (!this.conn) {
            this.conn = openConn('sql')
        }
        return this.conn
    }

    /** The wrapped shape: T occurs only inside `NonPromise<T>`, and every
     * occurrence of `NonPromise<T>` is itself inside a wrapper -- a callback
     * parameter's return, and the promise the method answers. */
    protected async withTransaction<T>(run: (db: Conn) => NonPromise<T>): Promise<NonPromise<T>> {
        const db = await this.getConnection()
        return db.runInTransaction(() => run(db))
    }
}

const sharedRows: number[] = [1, 2, 3]
const sharedRow: Row = { id: 1, name: 'a' }

class Store extends BaseStore {
    public async ids(): Promise<number[]> {
        return this.withTransaction((db) => {
            db.run('SELECT id')
            return sharedRows
        })
    }

    public async one(): Promise<Row> {
        return this.withTransaction((db) => {
            db.run('SELECT row')
            return sharedRow
        })
    }

    public async count(): Promise<number> {
        return this.withTransaction((db) => {
            db.run('SELECT count')
            return 7
        })
    }

    public async label(): Promise<string> {
        return this.withTransaction((db) => {
            db.run('SELECT label')
            return 'ok'
        })
    }

    /** The callback returns nothing, so T is void -- migrations.ts:487. */
    public async migrate(): Promise<void> {
        await this.withTransaction((db) => {
            db.run('INSERT migration')
        })
    }
}

/** The same wrapped shape as a FREE function, forwarding to the interface
 * member: the sync twin of this compiled before, the async one did not. */
async function tx<T>(conn: Conn, run: (db: Conn) => NonPromise<T>): Promise<NonPromise<T>> {
    return conn.runInTransaction(() => run(conn))
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
    console.log('label', await store.label())

    await store.migrate()
    console.log('void instantiation returned')

    const free = openConn('free')
    console.log('free number', await tx(free, () => 11))
    console.log('free string', await tx(free, () => 'twelve'))
    const back = await tx(free, () => sharedRow)
    console.log('free record identity', back === sharedRow)

    console.log(log.join('|'))
}

void main()
