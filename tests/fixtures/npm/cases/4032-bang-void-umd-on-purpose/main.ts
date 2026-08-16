// The UMD wrapper's forcing `!`: a shipped package whose whole module body
// is `!function(root, factory){...}(globalRef, factory)`. The `!` exists
// only to make the function parse as an expression -- the wrapper returns
// nothing, so the operand's type is `void`, which `ensureBool` has no arm
// for. The whole module factory becomes one SC2001 fence and the package
// throws on load.
//
// ON PURPOSE: this program does NOT byte-match Node, and the pin says so.
// This is zapo's `node_modules/long/umd/index.js` in miniature; 4031 is the
// wall that stands behind it -- see npm-static.test.ts.
import { ok } from "bangvoid"

console.log("ok", ok)
