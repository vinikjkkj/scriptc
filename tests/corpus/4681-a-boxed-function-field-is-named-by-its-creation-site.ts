// @dynamic
// `console.log({ aliased: helper })` — node answers `[Function: helper]`, and
// every walker-built box answered `[Function (anonymous)]` before this file
// existed. The box a RECORD-to-dyn walker builds sees a bare `ScrClosure *`
// in a field: it knows the FIELD's name and nothing else, and the field's
// name is a different thing the moment the field holds a function created
// somewhere else — which is line `aliased` below, where node says `helper`
// and the field says `aliased`. Naming it from the field would have traded a
// missing answer for a wrong one.
//
// The closure's ENTRY POINT is the key that works: every distinct function
// value has its own emitted body (or, declared-as-a-value, its own `sc_w_*`
// wrapper), so the pointer says WHICH function the value is — which is what
// JS's `.name` depends on, since a function is named once, at its creation
// site. The compiler emits that pointer→name table (ScrFnName) from its own
// closure creation sites and main() installs it.
//
// Every line here is a creation form JS's naming rules are written in terms
// of, plus the two that must stay `(anonymous)` because node says so.

function helper(n: number): number { return n + 1; }
const arrow = (n: number): number => n * 3;
let mut = (n: number): number => n;
mut = (n: number): number => n + 100;

function show(v: unknown): void { console.log(v); }

show({
  // NamedEvaluation: an anonymous arrow in a property position takes the
  // property's name.
  inline: (n: number): number => n * 2,
  // The creation site is a declaration elsewhere — NOT the field.
  aliased: helper,
  // An object-literal method is named by its property key.
  method(n: number): number { return n - 1; },
  // A named function expression keeps its own name, not the field's.
  named: function g(n: number): number { return n; },
  // Followed through a `const` binding to the arrow it was created as.
  fromConst: arrow,
  // …and through a reassigned `let`, whose last write is itself a
  // NamedEvaluation site (assignment to a plain identifier).
  fromLet: mut,
  // No creation site a compiler can see: an element read. node prints
  // `[Function (anonymous)]`, so does this.
  anon: [(n: number): number => n][0]!,
});

// A CAPTURING lambda: a fresh closure per call, named by the const it was
// created into, and still named after it has left the function.
function makeAdder(k: number): (n: number) => number {
  const added = (n: number): number => n + k;
  return added;
}
show({ made: makeAdder(2) });

// The values still WORK through the box — a name that cost the call would be
// a poor trade.
const r = {
  inline: (n: number): number => n * 2,
  aliased: helper,
};
show(r.inline(21));
show(r.aliased(41));
