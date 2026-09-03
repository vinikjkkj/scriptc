/* better-sqlite3 reached ONLY through values.
 *
 * sqlite-dynimport's fixture pins the seam where the namespace keeps its
 * TYPE from the import to the construction; this one pins the other side
 * of the same import, where the namespace is widened first and every
 * answer comes from the served VALUE surface (scr_sqlite_value.c). That is
 * the shape every optional-driver loader in the wild is written in —
 * zapo's store-sqlite/src/connection.ts:301 declares exactly the
 * `let loaded: unknown` this opens with.
 *
 * The cells are the ones a value surface gets wrong: own-key enumeration
 * and JSON (Node puts the five Database getters on the INSTANCE, so
 * Object.keys is NOT []), `typeof` of every documented member including
 * the ten with no lowering, absent-member reads, identity through the
 * `return this` members, the getters that CHANGE, and all four bind
 * spellings (positional, spread, a lone array, a named object).
 *
 * PROVENANCE of node-answers.txt: recorded against a live better-sqlite3
 * 13.0.3 under Node v25.9.0 on 2026-09-03. `ns.keys` is NODE-VERSION
 * dependent (the `module.exports` alias key is newer interop) — record it
 * under the Node this repository gates under, or that cell reads as a
 * regression that is really an oracle swap.
 */

type Row = Record<string, unknown>

type Stmt = {
    readonly run: (...a: unknown[]) => unknown
    readonly get: (...a: unknown[]) => unknown
    readonly all: (...a: unknown[]) => unknown
    readonly pluck: (...a: unknown[]) => unknown
    readonly columns: () => unknown
}

type DbLike = {
    readonly exec: (sql: unknown) => unknown
    readonly prepare: (sql: unknown) => unknown
    readonly close: () => unknown
    readonly pragma: (p: unknown, o: unknown) => unknown
}

function show(label: string, v: string): void {
    console.log(label + ' ' + v)
}

function bag(v: unknown): Record<string, unknown> {
    return v as Record<string, unknown>
}

// The METHOD members are own NON-ENUMERABLE properties here and prototype
// methods under Node — neither is an own enumerable key, so an
// index-signature view (`Record<string, unknown>`) cannot carry them: that
// cast MATERIALIZES here, and materializing copies own enumerable keys,
// which is what `{...db}` and `Object.assign` copy in Node too. Real code
// names the members it wants, so this view does.
type DbMembers = {
    readonly prepare: unknown
    readonly exec: unknown
    readonly close: unknown
    readonly pragma: unknown
    readonly transaction: unknown
    readonly function: unknown
    readonly backup: unknown
    readonly serialize: unknown
    readonly loadExtension: unknown
    readonly unsafeMode: unknown
    readonly aggregate: unknown
    readonly table: unknown
    readonly defaultSafeIntegers: unknown
    readonly explain: unknown
}
type StmtMembers = {
    readonly run: unknown
    readonly iterate: unknown
    readonly bind: unknown
    readonly columns: unknown
}

function asConstructor(loaded: unknown): new (path: string) => DbLike {
    const candidate = bag(loaded)['default']
    if (typeof candidate === 'function') {
        return candidate as new (path: string) => DbLike
    }
    throw new Error('invalid sqlite driver export')
}

async function main(): Promise<void> {
    let loaded: unknown
    loaded = await import('better-sqlite3')

    show('ns.typeof', typeof loaded)
    show('ns.keys', Object.keys(bag(loaded)).join(','))
    show('ns.json', JSON.stringify(loaded))
    show('ns.typeof.default', typeof bag(loaded)['default'])
    show('ns.typeof.SqliteError', typeof bag(loaded)['SqliteError'])
    show('ns.typeof.moduleExports', typeof bag(loaded)['module.exports'])
    show('ns.default.is.moduleExports', String(bag(loaded)['default'] === bag(loaded)['module.exports']))
    show('ns.typeof.absent', typeof bag(loaded)['nosuchexport'])
    show('ns.hasDefault', String('default' in bag(loaded)))
    show('ns.hasAbsent', String('nosuchexport' in bag(loaded)))

    const Database = asConstructor(loaded)
    const dbT = new Database(':memory:')

    dbT.exec('create table t(a integer, b text)')
    const ins: unknown = dbT.prepare('insert into t(a,b) values(?,?)')
    const insT = ins as Stmt

    // The SERVED database object, reached through the statement — the
    // whole-object cells below are this object's, not the record's.
    const db: unknown = bag(ins)['database']
    show('db.typeof', typeof db)
    show('db.keys', Object.keys(bag(db)).join(','))
    show('db.json', JSON.stringify(db))
    show('db.database.readTwiceSame', String(bag(ins)['database'] === bag(ins)['database']))
    show('db.typeof.prepare', typeof (db as DbMembers).prepare)
    show('db.typeof.exec', typeof (db as DbMembers).exec)
    show('db.typeof.close', typeof (db as DbMembers).close)
    show('db.typeof.pragma', typeof (db as DbMembers).pragma)
    show('db.typeof.transaction', typeof (db as DbMembers).transaction)
    show('db.typeof.function', typeof (db as DbMembers).function)
    show('db.typeof.backup', typeof (db as DbMembers).backup)
    show('db.typeof.serialize', typeof (db as DbMembers).serialize)
    show('db.typeof.loadExtension', typeof (db as DbMembers).loadExtension)
    show('db.typeof.unsafeMode', typeof (db as DbMembers).unsafeMode)
    show('db.typeof.aggregate', typeof (db as DbMembers).aggregate)
    show('db.typeof.table', typeof (db as DbMembers).table)
    show('db.typeof.defaultSafeIntegers', typeof (db as DbMembers).defaultSafeIntegers)
    show('db.typeof.explain', typeof (db as DbMembers).explain)
    show('db.typeof.absent', typeof bag(db)['nosuchmember'])
    show('db.has.absent', String('nosuchmember' in bag(db)))
    show('db.name', String(bag(db)['name']))
    show('db.open', String(bag(db)['open']))
    show('db.readonly', String(bag(db)['readonly']))
    show('db.memory', String(bag(db)['memory']))
    show('db.inTransaction', String(bag(db)['inTransaction']))
    show('db.exec.readTwiceSame', String((db as DbMembers).exec === (db as DbMembers).exec))

    // exec answers THE database: the value it returns is the same object
    // the statement points back at, and a second exec through it reaches
    // the same connection.
    const back: unknown = dbT.exec('create table u(x integer)')
    show('db.exec.returnsThis', String(back === db))
    ;(back as DbLike).exec("insert into u values(11)")

    show('stmt.typeof', typeof ins)
    show('stmt.keys', Object.keys(bag(ins)).join(','))
    show('stmt.typeof.run', typeof (ins as StmtMembers).run)
    show('stmt.typeof.iterate', typeof (ins as StmtMembers).iterate)
    show('stmt.typeof.bind', typeof (ins as StmtMembers).bind)
    show('stmt.typeof.columns', typeof (ins as StmtMembers).columns)
    show('stmt.typeof.absent', typeof bag(ins)['nosuchmember'])
    show('stmt.reader', String(bag(ins)['reader']))
    show('stmt.readonly', String(bag(ins)['readonly']))
    show('stmt.busy', String(bag(ins)['busy']))
    show('stmt.source', String(bag(ins)['source']))

    const i1 = bag(insT.run(1, 'one'))
    show('run.changes', String(i1['changes']))
    show('run.rowid', String(i1['lastInsertRowid']))

    // The bind spellings: positional, spread, a lone array, a named
    // object.
    insT.run(2, 'two')
    const params: unknown[] = [3, 'three']
    insT.run(...params)
    insT.run([4, 'four'])
    const insNamed = dbT.prepare('insert into t(a,b) values(@a,@b)') as Stmt
    const named: Record<string, unknown> = {}
    named['a'] = 5
    named['b'] = 'five'
    insNamed.run(named)

    const sel: unknown = dbT.prepare('select a, b from t order by a')
    const selT = sel as Stmt
    const rows = selT.all() as Row[]
    show('all.len', String(rows.length))
    show('all.rows', rows.map((r) => String(r['a']) + ':' + String(r['b'])).join(','))

    const one = dbT.prepare('select b from t where a = ?') as Stmt
    show('get.hit', String(bag(one.get(3))['b']))
    show('get.miss', String(one.get(99)))

    const chained = dbT.prepare('select x from u') as Stmt
    show('chained.exec.rows', String(bag(chained.get())['x']))

    // Statement identity through a `return this` member.
    const selBack: unknown = selT.pluck(true)
    show('stmt.pluck.returnsThis', String(selBack === sel))
    show('pluck.rows', (selT.all() as unknown[]).join(','))
    selT.pluck(false)

    const cl = selT.columns() as Row[]
    show('columns.names', cl.map((c) => String(c['name'])).join(','))

    try {
        const bad: unknown = dbT.prepare('select * from nosuchtable')
        show('prepare.bad', 'NO THROW ' + String(typeof bad))
    } catch (e) {
        const x = e as NodeJS.ErrnoException
        show('prepare.bad', x.name + '/' + String(x.code) + '/' + x.message)
    }

    const simple: Record<string, unknown> = {}
    simple['simple'] = true
    show('pragma.simple', String(dbT.pragma('journal_mode', simple)))

    const closedBack: unknown = dbT.close()
    show('db.close.returnsThis', String(closedBack === db))
    show('db.open.afterClose', String(bag(db)['open']))
    show('END', 'done')
}

void main()
