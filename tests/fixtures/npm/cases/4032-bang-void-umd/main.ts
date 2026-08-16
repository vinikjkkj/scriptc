// The UMD wrapper's forcing `!`: a shipped package whose whole module body
// is `!function(root, factory){...}(globalRef, factory)`. The `!` exists
// only to make the function parse as an expression -- the wrapper returns
// nothing, so the operand's type is `void`, which has no ToBoolean. In
// STATEMENT position there is no boolean to produce: the operand runs, the
// factory runs, and its output interleaves with the consumer's exactly as
// Node orders it.
import { ok } from "bangvoid"

console.log("ok", ok)
