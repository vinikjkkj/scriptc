// The island-backed ambient surface (number methods, string at, the Number statics, ...)
// typechecks against real static types but executes in the embedded
// engine: in a static build every use site is its own SC2012 naming the
// flag — never an ICE, never a link error. (EVERY Math member, sqrt, cbrt and the whole fdlibm family included, every
// Math constant, .split(string),
// the trim/pad variants, parseInt, isNaN, and the global
// parseFloat/isFinite over exactly-typed arguments compile statically
// now and no longer appear here.)
const price = (19.99).toPrecision(4);
const ch = "hello".at(0);
const n = Number.parseFloat("3.14");
