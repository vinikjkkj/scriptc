// The whole driver-shaped record, filled from `unknown` in one step —
// the boundary an optional-driver loader actually crosses.
//
// 7410 pins the ONE arm this needed (an optional function member). This
// pins the shape it appears in: a record whose required members are
// REST-signature functions, whose optional members are two spellings of
// the same method, and which is reached through `as new (p: string) =>
// DriverLike` — a constructor CAST out of `unknown`, whose result the
// adapter has to validate into the record per call.
//
// It is zapo's store-sqlite/src/connection.ts:11-23 and :72-99, with the
// package replaced by a plain object this program builds. That
// substitution is the point: the record boundary is the compiler's, and
// it must hold for any producer — the served better-sqlite3 value surface
// (tests/fixtures/sqlite-value) is the same walk over a different object,
// and this file is the half of it a corpus run can oracle without a
// native addon installed.
//
// The three things a wrong answer would look like:
//   * `db.prepare ?? db.query` throwing on a present function (the arm),
//   * `stmt.run(...params)` reaching the callee with ONE argument (the
//     pack) instead of the spread's own count (the rest ABI),
//   * a member the object does not have reading as anything but
//     undefined (the negative control every row here needs).

type StatementLike = {
  readonly run: (...args: unknown[]) => unknown
  readonly get: (...args: unknown[]) => unknown
  readonly all: (...args: unknown[]) => unknown
}

type DriverLike = {
  readonly exec: (sql: string) => unknown
  readonly close: () => unknown
  readonly pragma?: (pragma: string) => unknown
  readonly prepare?: (sql: string) => StatementLike
  readonly query?: (sql: string) => StatementLike
}

function asConstructor(loaded: unknown): new (path: string) => DriverLike {
  if (typeof loaded === "function") {
    return loaded as new (path: string) => DriverLike
  }
  if (loaded && typeof loaded === "object") {
    const candidate = (loaded as { default?: unknown }).default
    if (typeof candidate === "function") {
      return candidate as new (path: string) => DriverLike
    }
  }
  throw new Error("invalid driver export")
}

// The "package": a namespace-shaped object whose `default` is a
// constructor that answers a driver-shaped object. Everything below it is
// `unknown` to the compiler.
function makeNamespace(): unknown {
  const ns: Record<string, unknown> = {}
  ns["default"] = function Driver(this: unknown, path: string): unknown {
    const rows: string[] = []
    const stmt = (sql: string): unknown => {
      const s: Record<string, unknown> = {}
      s["run"] = (...args: unknown[]): unknown => {
        rows.push(sql + "|" + String(args.length))
        const info: Record<string, unknown> = {}
        info["changes"] = args.length
        return info
      }
      s["get"] = (...args: unknown[]): unknown => rows.length + args.length
      s["all"] = (...args: unknown[]): unknown => rows.concat([String(args.length)])
      return s
    }
    const db: Record<string, unknown> = {}
    db["name"] = path
    db["exec"] = (sql: string): unknown => {
      rows.push("exec|" + sql)
      return db
    }
    db["close"] = (): unknown => db
    db["prepare"] = stmt
    return db
  }
  return ns
}

const loaded = makeNamespace()
const Driver = asConstructor(loaded)
const db = new Driver(":memory:")

// A required function member: an exec whose result is discarded, and one
// whose result is read back through the same record type.
db.exec("create table t(a)")

// The optional pair, `??`-ed exactly as the driver loader spells it.
const prepare = db.prepare ?? db.query
console.log("prepare.present", prepare !== undefined)
console.log("query.absent", db.query === undefined)
console.log("pragma.absent", db.pragma === undefined)

if (prepare) {
  const ins = prepare("insert into t values(?)")
  console.log("stmt.run.typeof", typeof ins.run)
  console.log("stmt.get.typeof", typeof ins.get)
  console.log("stmt.all.typeof", typeof ins.all)

  // The three argument counts the rest ABI has to keep apart: none, a
  // literal list, and a SPREAD whose length is a run-time fact.
  const i0 = ins.run() as { changes: number }
  console.log("run.none", String(i0.changes))
  const i2 = ins.run(1, "one") as { changes: number }
  console.log("run.two", String(i2.changes))
  const params: unknown[] = [2, "two", true]
  const i3 = ins.run(...params) as { changes: number }
  console.log("run.spread", String(i3.changes))

  const sel = prepare("select a from t")
  console.log("get.value", String(sel.get()))
  const all = sel.all("x") as string[]
  console.log("all.len", String(all.length))
  console.log("all.last", all[all.length - 1] ?? "none")
}

db.close()
console.log("END", "done")
