// Catch bindings are deliberately NARROW: the binding is typed by what the
// exception cell can actually hold, so the supported uses are the narrowing
// tests (instanceof over hierarchy classes, typeof over primitives), reads
// under a proven narrow, rethrow, and the unknown-slot CONVERSION (an
// un-narrowed use typed `unknown` converts to a dynamic value — corpus
// 1554; `const copy = e` compiles now and is NOT in this fence corpus).
// Everything else must terminate in a clean fence — never a silent
// mis-read of the payload.
class Standalone {
  n = 1;
}
try {
  throw 2;
} catch (e) {
  const probe = (): boolean => e instanceof Error; // a closure capture COMPILES now
  console.log(probe());
}
try {
  throw 3;
} catch (e) {
  if (e instanceof Standalone) {
    // standalone classes carry no vtable for the payload test
    console.log("no");
  }
}
try {
  throw 4;
} catch ({ message }: any) {
  // destructuring patterns stay out
  console.log("no");
}
try {
  throw 5;
} catch (e) {
  e = "reassigned"; // the binding is read-only
}
try {
  throw 6;
} catch (e) {
  if (typeof e === "object") {
    // only the primitive typeof tests narrow
    console.log("no");
  }
}
