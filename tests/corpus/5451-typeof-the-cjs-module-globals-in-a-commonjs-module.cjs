// The CommonJS twin of 5450: the same reads in a module where Node really
// DOES define them.
//
// This is the control that makes 5450 a fix rather than a swap. The bare
// spellings must keep answering "function"/"string" here — a rule that
// answered "undefined" everywhere would pass 5450 and break every real
// CommonJS bundle, protobufjs's `inquire` included, whose CommonJS branch
// is the RIGHT one in a file like this.
//
// One line here is not a control but a second fix: the module globals are
// module-scope bindings, so they are not properties of `globalThis` in a
// CommonJS module either. The base compiler answered "function" for
// `typeof globalThis.require` in BOTH module kinds; Node answers
// "undefined" in both.
'use strict';

console.log("typeof require =", typeof require);
console.log("typeof __dirname =", typeof __dirname);
console.log("typeof __filename =", typeof __filename);

console.log("typeof globalThis.require =", typeof globalThis.require);
console.log("typeof globalThis.__dirname =", typeof globalThis.__dirname);
console.log("typeof globalThis.__filename =", typeof globalThis.__filename);

console.log(typeof require === "function" ? "cjs-branch" : "esm-branch");
console.log(typeof __dirname !== "undefined" ? "has-dirname" : "no-dirname");

// The values themselves are unchanged by any of this: __filename is still
// this file, and require still resolves a builtin.
console.log("basename ok:", __filename.endsWith("5451-typeof-the-cjs-module-globals-in-a-commonjs-module.cjs"));
const path = require('path');
console.log("dirname ok:", path.dirname(__filename) === __dirname);

console.log("process =", typeof process, "Buffer =", typeof Buffer);
console.log("Math =", typeof Math, "setTimeout =", typeof setTimeout);
