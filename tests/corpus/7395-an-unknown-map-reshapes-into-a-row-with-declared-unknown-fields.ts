// A `Record<string, unknown>` reshaping into a ROW: declared 'unknown'
// members beside the same index signature.
//
// This is the shape every SQL row in zapo's store-sqlite has. The driver
// answers `unknown`, the connection wrapper is declared
//
//   get<T extends Record<string, unknown>>(sql, params?): T | null
//
// and every call site names its own row type — `db.get<ContactRow>(…)`,
// where `ContactRow` is `{ jid: unknown; display_name: unknown; …;
// [key: string]: unknown }`. The generic is lowered at its CONSTRAINT, so
// the value in hand is the bare map and the call site's type is the row;
// the conversion between them is a record→record width lift.
//
// WHICH PLANNER RUNS is decided by one thing: whether the TARGET carries an
// index signature. Without one, recordWidthPlan takes the pair and has two
// arms for a target field the source does not declare — a keyed READ of the
// signature, and `absentDyn` for an 'unknown' field. WITH one, the pair
// routes to the overflow CAPTURE planner instead, which had neither: its
// only way to initialize such a field was to find an `undefined` ARM, and
// an 'unknown' field has no arm to find (it holds JS's undefined directly).
// So a row type with an index signature — which is what the constraint
// forces every row type to have — declined as a whole, and 83 refusals
// across thirteen store modules were that one missing arm.
//
// Nothing is lost by initializing those fields undefined: the capture's own
// overflow walk writes every runtime key through recordKeySet, which
// dispatches a key naming a declared field INTO that field. A row that has
// `jid` fills the declared slot; a row that does not keeps the undefined an
// absent property read answers anyway — which is exactly what
// recordWidthPlan's arms produce one planner over.
//
// The program reads BOTH ways on purpose: `r.jid` (the declared slot) and
// `r["jid"]` (the keyed read), because the capture's dispatch is the only
// thing that makes them the same value, and a version that wrote the key
// only into the overflow would still print the second one correctly.

interface Row {
  jid: unknown
  n: unknown
  [key: string]: unknown
}

function asRow(m: Record<string, unknown>): Row {
  return m as Row
}

function show(label: string, r: Row): void {
  console.log(
    label,
    "declared:",
    String(r.jid),
    String(r.n),
    "keyed:",
    String(r["jid"]),
    String(r["n"]),
    "overflow:",
    String(r["extra"])
  )
}

// A row that HAS every declared name, plus an overflow key.
const full: Record<string, unknown> = {}
full["jid"] = "5511999@s.whatsapp.net"
full["n"] = 7
full["extra"] = true
show("full", asRow(full))

// A row missing one declared name: the slot answers undefined, exactly the
// absent-property read, and the keyed read agrees with it.
const partial: Record<string, unknown> = {}
partial["jid"] = "gone"
const p = asRow(partial)
console.log("partial", String(p.jid), p.n === undefined, p["n"] === undefined)

// An EMPTY map: every declared field is the undefined, and the overflow is
// empty too.
const none: Record<string, unknown> = {}
const e = asRow(none)
console.log("empty", e.jid === undefined, e.n === undefined, e["anything"] === undefined)

// A row whose declared names arrive in the OPPOSITE insertion order to the
// declaration order: the dispatch is by key, not by position.
const rev: Record<string, unknown> = {}
rev["n"] = 42
rev["jid"] = "second"
show("reversed", asRow(rev))
