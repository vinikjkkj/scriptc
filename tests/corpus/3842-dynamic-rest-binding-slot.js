// @dynamic
// A JS `(...args)` rest parameter under --dynamic binds the ENGINE's own
// arguments array — one island value, not a static array — so the
// function LITERAL's signature is `(any) => any` while tsc's inference
// spells the rest `any[]` and maps the DECLARATION's slot to
// `(any[]) => any`. Nothing converts between the two, and JS sources
// defer their fences, so the declaration used to build clean and throw
//
//   Uncaught Error: '(any) => any' values where '(any[]) => any' is
//   expected is not supported yet [SC1090 at <file>:<line>]
//
// the first time the program reached it — a bracketed-SC throw in the
// emitted binary, on both backends. Both faces of the declaration rule
// are here: file scope (collectGlobals) and function scope
// (lowerVarDecl). Node is the oracle byte-for-byte.
"use strict";

function decl(a, b) {
  return a * 10 + b;
}

// File scope, pure rest.
const grab = (...args) => args[0];
console.log(`${grab(11, 22)}`);
console.log(`${grab("only")}`);
console.log(`${grab()}`);

// File scope, rest forwarded through a spread call.
const fwd = (...args) => decl(...args);
console.log(`${fwd(1, 2)}`);

// File scope, LEADING fixed parameters before the rest.
const lead = (x, ...rest) => decl(x, ...rest);
console.log(`${lead(7, 8)}`);

// File scope, the `function` spelling of the same shape.
const grabFn = function (...args) {
  return args[1];
};
console.log(`${grabFn("a", "b", "c")}`);

// File scope, chained rest-to-rest.
const chain = (...args) => fwd(...args);
console.log(`${chain(9, 10)}`);

// Function scope: the same declarations inside a body.
function inner(a, b) {
  const local = (...args) => args[0];
  const forward = (...args) => decl(...args);
  return `${local(a, b)}/${forward(a, b)}`;
}
console.log(inner(3, 4));

// A rest binding is still the engine's arguments array when the surplus
// is empty and when it is long.
const count = (...args) => args.length;
console.log(`${count()} ${count(1)} ${count(1, 2, 3, 4, 5)}`);

// The engine's array is a real array: index reads past the end answer
// undefined, exactly like Node.
const past = (...args) => args[3];
console.log(`${past(1, 2)}`);

console.log("end");
