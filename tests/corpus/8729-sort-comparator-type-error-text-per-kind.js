// The TypeError a sort/toSorted comparator that is not a function raises
// quotes the offender the way V8's NoSideEffectsToString does: `#<Ctor>` for
// an object with no callable toString, the [object Object] constant when it
// (or its chain) has one, a null-prototype record likewise, and the string
// image of a primitive. Covers the array and the typed-array forms.
function id(v) { return v; }
class A {}
class B { toString() { return 'b'; } }
class C extends B {}
const kinds = {
  plain: {}, ownToString: { toString() { return "x"; } }, nullproto: Object.create(null),
  arr: [1], num: 5, str: "s", nul: null, tru: true, date: new Date(0), re: /a/g, big: 10n,
  inst: new A(), withToString: new B(), derived: new C(), fn: () => 1,
};
for (const k of Object.keys(kinds)) {
  for (const m of ["sort", "toSorted"]) {
    try { id([3, 1, 2])[m](id(kinds[k])); console.log(k, m, "ok"); } catch (e) { console.log(k, m, e.name + ": " + e.message); }
  }
}
try { id([3,1,2]).sort(id(Symbol("q"))); } catch (e) { console.log("sym", e.name + ": " + e.message); }
for (const k of Object.keys(kinds)) {
  try { id(new Uint8Array([3, 1, 2])).sort(id(kinds[k])); console.log(k, "u8 sort ok"); } catch (e) { console.log(k, "u8 sort", e.name + ": " + e.message); }
  try { id(new Uint8Array([3, 1, 2])).toSorted(id(kinds[k])); console.log(k, "u8 toSorted ok"); } catch (e) { console.log(k, "u8 toSorted", e.name + ": " + e.message); }
}
