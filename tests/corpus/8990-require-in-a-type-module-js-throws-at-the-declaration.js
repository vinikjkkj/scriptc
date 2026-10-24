// A .js file under "type": "module" is an ES module, and Node defines no
// `require` in one. The package here is the corpus package (type: module).
// The reference throws ReferenceError before any specifier is looked at, so
// a declaration `const p = require("node:path")` throws at that statement,
// and nothing after it runs. Measured with Node v24.15.0: the uncaught throw
// exits 1 with the first line printed; the caught forms print the plain
// message. (This file uses require ON PURPOSE, to be refused: a .cjs rename
// would test the opposite fact.)

function why(e) {
    return e instanceof Error ? e.name + ": " + e.message : "not an Error: " + String(e);
}

console.log("typeof:", typeof require);

try {
    const p = require("node:path");
    console.log("declared:", typeof p);
} catch (e) {
    console.log("declared:", why(e));
}

try {
    console.log("call:", String(require("./no-such-file-here.js")));
} catch (e) {
    console.log("call:", why(e));
}

console.log("before the uncaught declaration");

const path = require("node:path");
console.log("never printed:", path.basename("/a/b.txt"));
