// Object.create's fence battery. A CHECKED-DYNAMIC prototype LOWERS
// (corpus 2763): a dyn object carries a real [[Prototype]] link, so the
// created object delegates live and lists no own keys by construction.
// A STATIC prototype still fences — a compiled record has no such link
// to be given, and an own-copy stand-in would answer both of those
// observations wrong, silently.

// A static record prototype.
const base = { indent: 2 };
const viaRecord = Object.create(base);

// A checked-dynamic (dyn) prototype: lowers, so no diagnostic.
const dynProto: object = JSON.parse('{"a":1}');
const viaDyn = Object.create(dynProto);

// The properties-descriptor form.
const withDescriptors = Object.create(null, { a: { value: 1, enumerable: true } });
