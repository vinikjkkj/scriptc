// An OPTIONAL function member, filled from `unknown`.
//
// A required function field has always been fillable: dynCheck's func arm
// tries the exact interned signature first and wraps anything else in the
// per-target adapter. An OPTIONAL one is a UNION (`func | undefined`), and
// a union picks its arm through the SOFT walker, whose func arm stopped at
// the exact signature — so `{ f: (s) => Row }` worked and
// `{ f?: (s) => Row }` threw `expected function | undefined at $.f, got
// function`, which named neither signature and was, for a present
// function, not even true.
//
// The shape is zapo's store-sqlite/src/connection.ts:86 — `const prepare =
// db.prepare ?? db.query` over a driver object that arrived as `unknown`,
// where both members are optional because two drivers spell the same
// method differently. Nothing here can be spelled with the exact
// signature: the value is a closure this program wrote, whose own type is
// `(string) => unknown`, and the slot wants `(string) => Row`.
//
// The widening is the one dynCheck already makes for a directly targeted
// func slot, moved to where a union arm can reach it. It does NOT loosen
// discrimination: the exact passes still run first, so a value boxed from
// an arm's own type still takes that arm, and a NON-function value still
// cannot take a function arm at all — which is what the `data` rows below
// are the control for.

type Row = { v: string }

type Api = {
  readonly make?: (s: string) => Row
  readonly other?: (s: string) => Row
  readonly gone?: (s: string) => Row
  readonly data?: ((s: string) => Row) | number
  readonly fn?: ((s: string) => Row) | number
}

function build(): unknown {
  const o: Record<string, unknown> = {}
  const mk = (tag: string) => (s: string): unknown => {
    const r: Record<string, unknown> = {}
    r["v"] = tag + ":" + s
    return r
  }
  o["make"] = mk("made")
  o["other"] = mk("other")
  // The two control members: one union carries a NUMBER where a function
  // arm is also on offer, the other carries the function.
  o["data"] = 7
  o["fn"] = mk("fn")
  return o
}

const api = build() as Api

// Present: read, tested, and CALLED through the slot's own signature —
// the adapter converts the argument in and validates the result out, so
// `.v` is read off a real Row.
const f = api.make ?? api.other
console.log("present", f !== undefined)
console.log("called", f ? f("x").v : "none")

// Absent: a member the value does not have is the undefined arm, and the
// `??` falls through to the one it does.
console.log("absent", api.gone === undefined)
const g = api.gone ?? api.other
console.log("fallback", g ? g("y").v : "none")

// The discrimination control, both ways: a union that offers a function
// arm AND a data arm takes the arm the VALUE is, not the first one.
console.log("data.isNumber", typeof api.data === "number")
console.log("data.value", typeof api.data === "number" ? api.data : -1)
console.log("fn.isFunction", typeof api.fn === "function")
console.log("fn.called", typeof api.fn === "function" ? api.fn("z").v : "none")

// The same member read twice is the same member: the adapter is built
// once, at the boundary, not once per read.
const a = api.make
const b = api.make
console.log("stable", a === b)
