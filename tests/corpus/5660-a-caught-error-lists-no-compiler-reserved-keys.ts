// The checked-dynamic tree encodes a runtime Error as a dyn object. It used to
// encode it as THREE OWN ENUMERABLE MEMBERS — a compiler-reserved "%error"
// marker plus `name` and `message` — sitting in the one table that
// Object.keys / getOwnPropertyNames / for-in / spread / Object.assign /
// Object.entries / JSON.stringify / structuredClone and the index-signature
// capture all read. So a program that caught an error and enumerated it saw
// the compiler's own bookkeeping key:
//
//     Object.keys(caught)   ["%error","name","message"]   Node: []
//     JSON.stringify(caught) {"%error":true,...}          Node: {}
//     "%error" in caught     true                         Node: false
//     caught["%error"]       true                         Node: undefined
//
// Node's shape is the fix: the [[Prototype]] link to %Error.prototype% carries
// `name`, `message` is an own NON-ENUMERABLE property, and there is no marker
// at all — `instanceof Error` reads the chain. Every surface below is Node's
// because `entries` is empty, not because each one remembered to filter.
let u: unknown;
try {
  throw new Error("boom");
} catch (x) {
  u = x;
}

console.log("keys      " + JSON.stringify(Object.keys(u as object)));
const forin: string[] = [];
for (const k in u as { [k: string]: unknown }) forin.push(k);
console.log("for-in    " + JSON.stringify(forin));
console.log("spread    " + JSON.stringify(Object.keys({ ...(u as { [k: string]: unknown }) })));
console.log("assign    " + JSON.stringify(Object.keys(Object.assign({} as { [k: string]: unknown }, u as { [k: string]: unknown }))));
console.log("entries   " + JSON.stringify(Object.entries(u as { [k: string]: unknown }).map((e) => e[0])));
console.log("json      " + JSON.stringify(u));
console.log("in        " + ("%error" in (u as object)) + " " + ("name" in (u as object)));
console.log("read      " + String((u as { [k: string]: unknown })["%error"]));
console.log("hasOwn    " + Object.hasOwn(u as object, "%error") + " " + Object.hasOwn(u as object, "name"));

// ...and the reads that have to keep working, because the members did not
// disappear — they moved to where JS keeps them.
console.log("message   " + (u as Error).message);
console.log("name      " + (u as Error).name);
console.log("instof    " + (u instanceof Error));
console.log("toString  " + (u as Error).toString());
console.log("String    " + String(u));

// The kind's name is TypeError.prototype.name in Node — reachable, and still
// not an own key of the instance.
let t: unknown;
try {
  throw new TypeError("bad");
} catch (x) {
  t = x;
}
console.log("t.keys    " + JSON.stringify(Object.keys(t as object)));
console.log("t.name    " + (t as Error).name);
console.log("t.hasOwn  " + Object.hasOwn(t as object, "name"));
console.log("t.String  " + String(t));
