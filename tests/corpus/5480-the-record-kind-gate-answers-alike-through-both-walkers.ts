// The record KIND GATE, exercised through BOTH walker disciplines, on BOTH
// backends.
//
// Since the matcher and the builder were merged into one body generator,
// "can this receiver satisfy this cast?" and "which arm does this value
// belong to?" are answered by the same emitted code in two disciplines:
//
//   sc_dc_<n>(d, path)          the HARD body — refuses with a catchable,
//                               path-annotated TypeError
//   sc_da_<n>(d, path, ok)      the SOFT body — reports a MISS through *ok
//                               so the union tries its next arm
//
// and the only thing separating them is one boolean. That is the whole
// hazard: an edit to the gate reaches arm selection unless it says
// otherwise. It says otherwise in exactly one place now
// (backend/kindgate.ts's kindgateWideLane), for both the C emitter and the
// LLVM one, and this file is the behavioural half of that guard.
//
// Every line below is Node's own answer, so a gate that starts admitting
// non-object receivers — on either lane, in either discipline — turns this
// into a differential failure rather than into a number in a report. Under
// the control dial SCRIPTC_KINDGATE_MATCH=1 the two `arm=` lines fed a
// STRING move (both lanes, identically); under SCRIPTC_KINDGATE_WIDE=1 not
// one line moves on either lane, which is the hard/soft separation stated as
// an experiment rather than as a claim.

type Len = { length: number };
type Named = { name: string };
type Pair = [string, number];
type Idx = { [k: string]: string };
type Opt = { a?: Len };
type Nest = { inner: Len; tag: string };
type Bag = { items: Len[] };

// `unknown[]` plus a computed index is what defeats the checker's
// narrowing: every cast below is a real runtime crossing, not a no-op the
// frontend folded away.
function hide(v: unknown): unknown {
  const box: unknown[] = [v];
  return box[box.length - 1];
}

// ── the HARD body: a direct cast ────────────────────────────────────────
// Width tolerance is check-and-extract, not shape equality: undeclared keys
// are simply never examined.
{
  const r = hide({ length: 3, extra: "ignored" }) as Len;
  console.log("hard len=" + r.length);
}
{
  const r = hide({ name: "n", length: 9 }) as Named;
  console.log("hard name=" + r.name);
}

// ── the SOFT body: a union arm ──────────────────────────────────────────
// An array HAS a `length` and a string HAS a `length`, and neither is the
// record arm. This is the pin the widened-matcher control breaks.
function armLenOrStrArr(r: Len | string[]): string {
  if (Array.isArray(r)) {
    const a = r as string[];
    return "array n=" + a.length;
  }
  return "record n=" + (r as Len).length;
}
function armLenOrString(r: Len | string): string {
  if (typeof r === "string") return "string n=" + r.length;
  return "record n=" + (r as Len).length;
}
console.log("arm=" + armLenOrStrArr(hide(["x", "y", "z"]) as Len | string[]));
console.log("arm=" + armLenOrStrArr(hide({ length: 4 }) as Len | string[]));
console.log("arm=" + armLenOrString(hide("abcd") as Len | string));
console.log("arm=" + armLenOrString(hide("") as Len | string));
console.log("arm=" + armLenOrString(hide({ length: 7 }) as Len | string));

// ── an OPTIONAL record-typed member is arm-only even at a direct cast ───
// `{ a?: Len }` makes the member a union (`Len | undefined`), so the record
// is reached through that union's arm chain even here. Present and absent
// both answer, and the absent key IS the undefined arm rather than a miss.
{
  const r = hide({ a: { length: 2 } }) as Opt;
  const a = r.a;
  console.log("opt present=" + (a === undefined ? "none" : String(a.length)));
}
{
  const r = hide({ b: 1 }) as Opt;
  const a = r.a;
  console.log("opt absent=" + (a === undefined ? "none" : String(a.length)));
}

// NOTE, deliberately NOT pinned here: a member provided by an object-literal
// GETTER. The dyn walk probes `scr_dyn_obj_accessor_get` on the miss path,
// but the static→dyn converter writes a shape's `%get:x` accessor slot as an
// ordinary data key holding a closure rather than as a dyn HIDDEN accessor,
// so the probe finds nothing: a required member refuses loudly ("got
// undefined") and an OPTIONAL one answers the undefined arm SILENTLY where
// Node calls the getter. Both lanes do it identically, so it is not a
// backend divergence; it is a divergence from Node, it predates this file,
// and pinning today's answer here would pin the wrong one. See
// estado-gatemirror.md.

// ── a member that may hold a FUNCTION: the second hard edge ─────────────
{
  const src: unknown = { f: (x: number): number => x + 1 };
  const r = hide(src) as { f: (x: number) => number };
  console.log("func=" + r.f(2));
}

// ── nested records, and a record inside an array ────────────────────────
{
  const r = hide({ inner: { length: 6 }, tag: "t" }) as Nest;
  console.log("nested=" + r.inner.length + " " + r.tag);
}
{
  const r = hide({ items: [{ length: 1 }, { length: 2 }] }) as Bag;
  console.log("bag=" + r.items.length + " " + r.items[0]!.length + " " + r.items[1]!.length);
}

// ── the shapes that must NEVER take a wide lane ─────────────────────────
// A TUPLE wants a JSON array of exactly its arity; an INDEX SIGNATURE
// captures the undeclared keys, which a projection carrying only declared
// ones could not answer.
{
  const r = JSON.parse('["s", 2]') as Pair;
  console.log("tuple=" + r[0] + " " + r[1]);
}
{
  const r = JSON.parse('{"a":"va","b":"vb"}') as Idx;
  console.log("idx=" + r["a"] + " " + r["b"] + " " + String(r["missing"]));
}

// ── the refusals that STAY, on both lanes ───────────────────────────────
// Node throws here too, so only the fact of the throw is printed: the
// message wording is a documented divergence and is not what this file is
// for.
function threw(f: () => void): string {
  try {
    f();
    return "no";
  } catch (e) {
    return (e as Error).name;
  }
}
console.log(
  "refuse null=" +
    threw(() => {
      const r = hide(null) as Len;
      console.log(r.length);
    }),
);
console.log(
  "refuse undefined=" +
    threw(() => {
      const r = hide(undefined) as Len;
      console.log(r.length);
    }),
);

export {};
