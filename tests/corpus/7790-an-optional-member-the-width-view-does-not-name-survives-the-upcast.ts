export {}
// A record flowing into a shape that does not name one of its members is a
// RELABEL in TypeScript, and widening back reaches the member the narrow
// type never mentioned -- because there is only ever one object. scriptc
// used to copy here, so the member was gone and the read answered undefined.
// The member is OPTIONAL-flavored, which is what lets the narrow shape carry
// the slot without gaining a key: shape unification merges the two shapes
// and the copy becomes the identity.
interface A { a: number }
interface OptB { a: number; b?: number }

function take(x: A): A { return x }

const optBig: OptB = { a: 1, b: 2 }
const optNarrow = take(optBig)
console.log(String((optNarrow as unknown as OptB).b))

// Identity, the same fact from the other side.
optNarrow.a = 9
console.log(optBig.a + " " + optNarrow.a)

// ...and the narrow shape's OWN keys are still its own: a value built at
// `A` has one key, whatever the struct behind it now holds.
const only: A = { a: 5 }
console.log(Object.keys(only).join(",") + " " + JSON.stringify(only) + " " + Object.hasOwn(only, "b"))
