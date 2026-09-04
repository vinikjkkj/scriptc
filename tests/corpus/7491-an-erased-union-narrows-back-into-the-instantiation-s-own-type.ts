// The value coming OUT of an erased generic member is the union of every
// type the PROGRAM instantiates it at (7430's rule). Where the caller's own
// type is narrower, the value has to narrow back -- and inside an ASYNC
// generic that narrowing had nowhere to happen.
//
// zapo's `WaPreKeySqliteStore.consumePreKeyById` is the shape:
//
//   protected async withTransaction<T>(
//       run: (connection: WaSqliteConnection) => NonPromise<T>
//   ): Promise<NonPromise<T>> {
//       const db = await this.getConnection()
//       return db.runInTransaction(() => run(db))
//   }
//   // instantiated at PreKeyRecord | null, at number, at
//   // { available; reservedKeyIds }, at void, ...
//
// `db.runInTransaction` is a signature-only interface member with a bare
// `<T>`, so its IR return is the erasure union of ALL those instantiations.
// The enclosing instance's declared return is the narrow one. The bridge
// that narrows a union back into a sub-union already exists
// (narrowedRetagHelper: the arms the CHECKER proves away at the site become
// runtime traps, so a violated proof throws a catchable TypeError and never
// smuggles a wrong arm), and coerceInto already consults it.
//
// It never fired here. An async `return <promise>` FLATTENS: the value
// coerceInto is handed is the awaited PAYLOAD, while the node it reads the
// checker's type off still spells `Promise<NonPromise<T>>`. A promise is
// not an arm of a value union, so the bridge declined and the coercion fell
// through to SC2003 -- 'expected null | Row, got number | null | Row'. The
// SYNC twin of this same program compiled, which is the whole bisection.
//
// The narrow set below is a UNION (`Row | null`) on purpose: a single-arm
// instantiation takes the plain arm path and never needed the bridge.

type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
type Task<T> = () => NonPromise<T>

interface Conn {
    run(sql: string): void
    runInTransaction<T>(task: Task<T>): Promise<NonPromise<T>>
}

interface Row {
    id: number
    name: string
}

interface Reservation {
    available: number[]
    reservedKeyIds: number[]
}

const log: string[] = []

function openConn(): Conn {
    const run = (sql: string): void => {
        log.push(sql)
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

const stored: Row = { id: 1, name: 'a' }

abstract class BaseStore {
    private conn: Conn | null = null

    protected async getConnection(): Promise<Conn> {
        if (!this.conn) {
            this.conn = openConn()
        }
        return this.conn
    }

    protected async withTransaction<T>(run: (db: Conn) => NonPromise<T>): Promise<NonPromise<T>> {
        const db = await this.getConnection()
        return db.runInTransaction(() => run(db))
    }
}

class Store extends BaseStore {
    /** consumePreKeyById: the narrow destination is `Row | null`. */
    public async consume(hit: boolean): Promise<Row | null> {
        return this.withTransaction((db) => {
            db.run('SELECT row')
            return hit ? stored : null
        })
    }

    /** getOrGenPreKeys: a record instantiation. */
    public async reserve(): Promise<Reservation> {
        return this.withTransaction((db) => {
            db.run('SELECT reservation')
            return { available: [1, 2], reservedKeyIds: [3] }
        })
    }

    /** countPreKeys: a number instantiation. */
    public async count(): Promise<number> {
        return this.withTransaction((db) => {
            db.run('SELECT count')
            return 7
        })
    }

    /** An array instantiation, so the erasure union is not two arms wide. */
    public async ids(): Promise<number[]> {
        return this.withTransaction((db) => {
            db.run('SELECT ids')
            return [4, 5, 6]
        })
    }

    /** migrations.ts:487 -- the void instantiation. */
    public async migrate(): Promise<void> {
        await this.withTransaction((db) => {
            db.run('INSERT migration')
        })
    }
}

async function main(): Promise<void> {
    const s = new Store()

    const hit = await s.consume(true)
    console.log('hit identity', hit === stored)
    if (hit !== null) {
        hit.name = 'z'
        console.log('write through the returned record', stored.name)
    }
    console.log('miss', await s.consume(false))

    console.log('reserve', JSON.stringify(await s.reserve()))
    console.log('count', await s.count())
    console.log('ids', JSON.stringify(await s.ids()))

    await s.migrate()
    console.log('void instantiation returned')

    console.log(log.join('|'))
}

void main()
