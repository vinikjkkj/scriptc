// The OTHER half of the same fact. A reserved key cannot mark anything,
// because "%" is a legal first character of a JavaScript property name — so
// while the compiler's marker was leaking OUT into every enumeration surface,
// a user's own "%error" key was being read IN as the marker:
//
//     JSON.parse('{"%error":true,"name":"Error","message":"x"}')
//       instanceof Error   true          Node: false
//       String(...)        "Error: x"    Node: "[object Object]"
//
// Both halves close together, because the encoding stopped being a key at all:
// `instanceof Error` reads the [[Prototype]] chain, and %Error.prototype% is a
// process singleton compared by IDENTITY, which no spelling can reach.
const parsed = JSON.parse('{"%error":true,"name":"Error","message":"x"}') as unknown;
console.log("instof    " + (parsed instanceof Error));
console.log("String    " + String(parsed));
console.log("keys      " + JSON.stringify(Object.keys(parsed as object)));

// A literal one, on the way in through a record with an index signature.
const own: { [k: string]: unknown } = { "%error": 1, "%get:a": 2, b: 3 };
const d: unknown = own;
console.log("lit.instof " + (d instanceof Error));
console.log("lit.keys   " + JSON.stringify(Object.keys(d as object)));
console.log("lit.read   " + String((d as { [k: string]: unknown })["%error"]) +
            " " + String((d as { [k: string]: unknown })["%get:a"]));
console.log("lit.String " + String(d));
console.log("lit.json   " + JSON.stringify(d));

// And the round trip that worked before this change and has to keep working:
// these keys are DATA, and JSON is where a program most often meets them.
const rt = JSON.parse('{"%get:a":1,"%error":2,"b":3}') as { [k: string]: number };
console.log("rt.keys   " + JSON.stringify(Object.keys(rt)));
console.log("rt.vals   " + rt["%error"] + " " + rt["%get:a"] + " " + rt["b"]);
console.log("rt.json   " + JSON.stringify(rt));
