// A record whose FIELDS are factories returning CLASS INSTANCES, flowing
// into a slot that spells the same members STRUCTURALLY.
//
// This is zapo's store-backend handshake reduced to two domains:
//
//   createStore({ backends: { sqlite: createSqliteStore({ path }) }, … })
//
// where `createSqliteStore` answers `{ stores: { auth: (id) => WaAuthSqlite
// Store; … }; caches: { … } }` — fifteen factories, every one returning a
// nominal CLASS — and `createStore` takes `{ stores: { auth: (id) =>
// WaAuthStore; … } }`, where every one of those is an INTERFACE. tsc
// assigns the pair for free; the class satisfies the interface.
//
// The conversion that makes it real is the funcAdapt lift with a
// class-instance RETURN, and the compiler has always been able to BUILD it
// (funcCoerceAdapter's `classRetProj`, the constructor-witness projection
// one call deeper). Only the PLAN side declined: cleanFuncAdaptable, the
// width family's gate on func slots, probed coercibleValue for the return
// and coercibleValue has no class→record rung — "a class is NOT a record
// anywhere else", which is true everywhere except this one position.
//
// So the two positions DISAGREED. Handing the factory straight to a slot
// typed by the interface lowered (top level, funcCoerceAdapter's own rung);
// handing it inside a record whose slot spells the same pair refused. Both
// spellings are in this program, one after the other, so a revert makes the
// second one fail rather than quietly drop out.
//
// The instances the adapted factories mint are ONE PER CALL, exactly as
// under Node: the projection binds methods to a fresh instance and the
// counters below prove the two calls do not share state.

interface CounterView {
  bump(n: number): number
  total(): number
  readonly label: string
}

class SqliteCounter {
  private v = 0
  public readonly label: string
  constructor(label: string) {
    this.label = label
  }
  public bump(n: number): number {
    this.v += n
    return this.v
  }
  public total(): number {
    return this.v
  }
}

class MemoryCounter {
  private v = 100
  public readonly label: string
  constructor(label: string) {
    this.label = label
  }
  public bump(n: number): number {
    this.v += n * 2
    return this.v
  }
  public total(): number {
    return this.v
  }
}

/** The SOURCE shape: factories returning the nominal classes. */
interface Made {
  readonly stores: {
    readonly hot: (id: string) => SqliteCounter
    readonly cold: (id: string) => MemoryCounter
  }
}

/** The SLOT shape: the same members, spelled structurally. */
interface Backend {
  readonly stores: {
    readonly hot: (id: string) => CounterView
    readonly cold: (id: string) => CounterView
  }
}

function build(): Made {
  return {
    stores: {
      hot: (id: string) => new SqliteCounter(id),
      cold: (id: string) => new MemoryCounter(id)
    }
  }
}

function drive(b: Backend): void {
  const a = b.stores.hot("a")
  const c = b.stores.hot("c")
  console.log(a.label, a.bump(3), a.bump(4), a.total())
  console.log(c.label, c.bump(1), c.total())
  const m = b.stores.cold("m")
  console.log(m.label, m.bump(5), m.total())
}

// THE NESTED position — the one that refused. `made` is a BINDING, so the
// conversion is left for the compiler rather than folded away by tsc's
// contextual typing of a fresh literal.
const made = build()
drive(made)

// THE TOP-LEVEL position — the one that already lowered. Same pair of
// types, one nesting level out, so the two must agree.
function driveOne(f: (id: string) => CounterView): void {
  const v = f("solo")
  console.log(v.label, v.bump(9), v.total())
}
driveOne(made.stores.hot)
driveOne(made.stores.cold)
