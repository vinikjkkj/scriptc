// An object-literal ACCESSOR crosses the static->dynamic boundary as a real
// accessor (corpus 14300-14312 pin that the crossed value answers Node's
// surfaces), and the dynamic->static direction stays refused.
//
// The refusal left here is the OUT direction: a target shape declaring an
// accessor asks for a `%get:a` FUNCTION that a dyn value does not carry as a
// member, so a checked cast into it is refused by name rather than validated.
//
// (The IN cases that used to be pinned here -- the literal itself, a record
// field, an array element -- now convert and are covered by the corpus.)

// -- OUT: an accessor-declaring TARGET ---------------------------------
const parsed: unknown = JSON.parse('{"a":5}');
const back = parsed as { get a(): number };
console.log(back.a);

// -- OUT: one container down -------------------------------------------
const parsed2: unknown = JSON.parse('{"inner":{"a":5}}');
const back2 = parsed2 as { inner: { get a(): number } };
console.log(back2.inner.a);
