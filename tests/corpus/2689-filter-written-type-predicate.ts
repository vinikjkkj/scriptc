// `.filter((x): x is T => ...)` with a WRITTEN type predicate.
//
// An INFERRED predicate earns the unchecked re-tag: the checker proved the
// arm from the body. A written `x is T` proves nothing at runtime -- it is the
// program's claim -- so each kept element rides the CHECKED extraction
// instead, the same machinery `x!` uses.
//
// The consequence is deliberate and is NOT exercised here, because a corpus
// case has to match Node: a LYING predicate throws the catchable TypeError at
// the filter, where Node keeps the element and lets a later read answer
// undefined. That is the stance the compiler already takes for `x!` and for an
// overload whose implementation never honoured its return -- a wrong answer is
// worse than a named throw.
type Ok = { readonly status: "ok"; readonly value: number };
type Err = { readonly status: "err"; readonly reason: string };
type R = Ok | Err;

const all: R[] = [
  { status: "ok", value: 1 },
  { status: "err", reason: "boom" },
  { status: "ok", value: 3 },
  { status: "err", reason: "late" },
];

const errs = all.filter((r): r is Err => r.status === "err");
console.log(errs.length, errs.map((e) => e.reason).join(","));

const oks = all.filter((r): r is Ok => r.status === "ok");
console.log(oks.length, oks.map((o) => o.value).join(","));

// Nothing matching is the empty array, not a throw.
const none = all.filter((r): r is Ok => r.status === "ok" && r.value > 100);
console.log(none.length);

// The inferred spelling still works, and agrees.
const inferred = all.filter((r) => r.status === "err");
console.log(inferred.length);
