// An object-literal ACCESSOR does not cross the static<->dynamic boundary,
// in either direction, and both halves are refusals rather than answers.
//
// `{ get a() {...} }` interns as a shape carrying a RESERVED '%'-field
// `%get:a` whose type is a closure; the property name `a` itself has no
// data slot. The dyn object model has no representation for an ENUMERABLE
// accessor -- its accessor table is the NON-enumerable
// Object.defineProperty family -- so a crossing value would carry the
// reserved slot as an ordinary key and lack the property Node answers.
// Left admitted (the func-field rule, written for a method bundle, waved
// `%get:a` through because its type is `func`) every dyn surface answered
// wrong and most of them answered SILENTLY: Object.keys / for-in / spread /
// Object.assign / getOwnPropertyNames listed "%get:a", JSON.stringify
// dropped the member, `in` said false, util.inspect printed the marker, and
// a dyn record check read the member as ABSENT -- a required one threw
// "got undefined", an OPTIONAL one built the undefined arm and said nothing.
//
// The OUT direction is the same slot seen from the other side: a target
// shape declaring an accessor asks the walker for a `%get:a` FUNCTION the
// dyn value never has, and the refusal it produced spelled a reserved
// internal marker into the user's TypeError ("expected function at
// $.%get:a, got undefined").

// -- IN: the literal itself -------------------------------------------
const withGetter = {
  get a(): number {
    return 5;
  },
};
const u: unknown = withGetter;
console.log(typeof u);

// -- IN: one container down, as a record FIELD -------------------------
const nested = { inner: { get a(): number { return 5; } } };
const un: unknown = nested;
console.log(typeof un);

// -- IN: one container down, as an ARRAY ELEMENT -----------------------
const list = [{ get a(): number { return 5; } }];
const ul: unknown = list;
console.log(typeof ul);

// -- OUT: an accessor-declaring TARGET ---------------------------------
const parsed: unknown = JSON.parse('{"a":5}');
const back = parsed as { get a(): number };
console.log(back.a);

// -- OUT: one container down -------------------------------------------
const parsed2: unknown = JSON.parse('{"inner":{"a":5}}');
const back2 = parsed2 as { inner: { get a(): number } };
console.log(back2.inner.a);
