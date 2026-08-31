// Reading a property of `globalThis` that this host does not have.
//
// JavaScript has one answer for an absent property of the global object —
// `undefined` — and it is not a special case: Node started without
// `--expose-gc` answers exactly that for `gc`, and a compiled binary, which
// has no gc to expose, answers the same. This is the shape every benchmark
// carries, and the first thing zapo's messaging bench asks its host.
//
// The typeof print is load-bearing: it separates the right answer from the
// two wrong ones this compiler could give. A JavaScript-source identity
// TOKEN would print "string"; a lowering that invented the capability would
// print "function". Only "undefined" is Node's answer.
function hasExposedGc(): boolean {
  return typeof (globalThis as { gc?: () => void }).gc === "function";
}
function forceGcIfAvailable(): string {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) {
    g();
    return "ran gc";
  }
  return "no gc";
}
console.log(hasExposedGc());
console.log(typeof (globalThis as { gc?: () => void }).gc);
console.log((globalThis as { gc?: () => void }).gc === undefined);
console.log(forceGcIfAvailable());

// A name NOTHING declares (`window`, the browser sniff) deliberately does
// NOT fold and keeps its refusal. Absence of a declaration is not evidence
// of absence: the shipped fallback declares what scriptc SUPPORTS, so
// silence there means "unsupported", never "the host does not have it" —
// folding on silence answered `undefined` for two dozen globals Node
// really has. The evidence has to be a declaration that says so.

// The globals that ARE here must still come through the same receiver.
console.log(typeof globalThis.process.argv.length === "number");
console.log(typeof globalThis.JSON.stringify({ a: 1 }));
