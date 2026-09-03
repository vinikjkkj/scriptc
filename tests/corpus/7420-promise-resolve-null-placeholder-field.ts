// `Promise.resolve(null as never)` as a record field's PLACEHOLDER — zapo's
// sqlite connection cache, store-sqlite/src/connection.ts:452:
//
//   const createdEntry: SqliteConnectionCacheEntry = {
//       connection: null,
//       connectionPromise: Promise.resolve(null as never),
//       refs: 0
//   }
//   createdEntry.connectionPromise = createdConnection.then(...).catch(...)
//   ...
//   await entry.connectionPromise            // discarded
//
// tsc types the call `Promise<never>`, which maps to promise<void> on the
// stated ground that a throw-only promise never fulfils, so no await can
// observe a fulfillment value. THIS one fulfils, with `null`, into a slot
// spelled `Promise<WaSqliteConnection>` — and no record representation holds
// a null, so the site fenced ("Promise.resolve with an argument at a
// void-promise type").
//
// The field's PAYLOAD is void now, decided over the whole program (a shape is
// interned from the type, long before any producer is seen, so both values of
// one interface must share a layout). The promise still settles, a rejection
// still propagates and is still catchable, and reading the fulfillment value
// refuses at compile time — which is the one answer that is never wrong,
// since node's is `null` and no `WaSqliteConnection` slot holds one. The
// fences that stay are pinned next door in
// tests/diagnostics/promise-resolve-null-placeholder-fences.ts.
//
// Rows: the placeholder settling BEFORE any reassignment (r01/r02) — that is
// the poison observed directly, at the only position that can observe it;
// `.then` and `Promise.all` over the field (r03/r04); the sibling fields of
// the marked record untouched (r05); zapo's full flow, both the fulfilling
// and the rejecting driver, with the cache bookkeeping the catch arm does
// (r06..r13); a second value of the SAME interface sharing the layout (r14);
// and a `Promise<void>`-declared field beside a marked one, to show the
// marking is per property and not per record (r15/r16).

interface Conn {
    readonly driver: string
    exec(sql: string): void
}

interface Entry {
    connection: Conn | null
    connectionPromise: Promise<Conn>
    refs: number
}

interface Mixed {
    ready: Promise<Conn>
    done: Promise<void>
    tag: string
}

const CACHE = new Map<string, Entry>()

function openDriver(name: string, fail: boolean): Promise<Conn> {
    return (async (): Promise<Conn> => {
        if (fail) throw new Error(`open failed: ${name}`)
        return {
            driver: name,
            exec(sql: string): void {
                console.log(`exec ${sql}`)
            },
        }
    })()
}

async function openConn(key: string, fail: boolean): Promise<Conn> {
    let entry = CACHE.get(key)
    if (!entry) {
        const createdConnection = openDriver(key, fail)
        const createdEntry: Entry = {
            connection: null,
            connectionPromise: Promise.resolve(null as never),
            refs: 0,
        }
        createdEntry.connectionPromise = createdConnection
            .then((connection) => {
                createdEntry.connection = connection
                console.log(`r08 opened ${key}`)
                return connection
            })
            .catch((error) => {
                if (CACHE.get(key) === createdEntry) CACHE.delete(key)
                console.log(`r09 failed ${error instanceof Error ? error.message : String(error)}`)
                throw error
            })
        CACHE.set(key, createdEntry)
        entry = createdEntry
    }
    if (!entry) throw new Error('cache entry was not initialized')
    entry.refs += 1
    try {
        await entry.connectionPromise
    } catch (error) {
        entry.refs = Math.max(0, entry.refs - 1)
        if (entry.refs === 0 && CACHE.get(key) === entry) CACHE.delete(key)
        throw error
    }
    const conn = entry.connection
    if (!conn) throw new Error('connection missing after settle')
    return conn
}

async function main(): Promise<void> {
    // The placeholder, observed at the ONLY position that can observe it: it
    // settles, and it settles fulfilled (a rejecting one would take the catch).
    const fresh: Entry = {
        connection: null,
        connectionPromise: Promise.resolve(null as never),
        refs: 0,
    }
    console.log('r01 before')
    await fresh.connectionPromise
    console.log('r02 settled')
    let thenRan = 0
    await fresh.connectionPromise.then(() => {
        thenRan += 1
    })
    console.log(`r03 then ${thenRan}`)
    try {
        await fresh.connectionPromise
        console.log('r04 no rejection')
    } catch {
        console.log('r04 rejected')
    }
    console.log(`r05 siblings ${String(fresh.connection === null)} ${fresh.refs}`)

    // zapo's flow. Two opens of one key share the cache entry; the failing
    // key runs the catch arm and leaves the cache as it found it.
    const a = await openConn('better-sqlite3', false)
    console.log(`r06 driver ${a.driver}`)
    a.exec('select 1')
    const b = await openConn('better-sqlite3', false)
    console.log(`r07 cached ${String(CACHE.size)} ${b.driver}`)
    try {
        await openConn('bun', true)
        console.log('r10 unreachable')
    } catch (err) {
        console.log(`r10 caught ${err instanceof Error ? err.message : String(err)}`)
    }
    console.log(`r11 cache ${String(CACHE.size)}`)
    const held = CACHE.get('better-sqlite3')
    console.log(`r12 refs ${held ? held.refs : -1}`)
    console.log(`r13 held ${String(held !== undefined && held.connection !== null)}`)

    // A second value of the same interface: one interned layout, so the
    // placeholder and a real promise sit in the same slot.
    const second: Entry = {
        connection: null,
        connectionPromise: Promise.resolve(null as never),
        refs: 7,
    }
    second.connectionPromise = openDriver('second', false)
    await second.connectionPromise
    console.log(`r14 second ${second.refs}`)

    // The mark is per PROPERTY. `ready` is filled with the placeholder here;
    // `done` is declared Promise<void> and never was.
    const mixed: Mixed = {
        ready: Promise.resolve(null as never),
        done: Promise.resolve(),
        tag: 'mixed',
    }
    await mixed.ready
    await mixed.done
    console.log(`r15 mixed ${mixed.tag}`)
    mixed.ready = openDriver('mixed', false)
    await mixed.ready
    console.log('r16 mixed reassigned')
}

main()
