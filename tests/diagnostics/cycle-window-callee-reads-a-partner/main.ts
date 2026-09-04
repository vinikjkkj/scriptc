// NEGATIVE CONTROL for the inert-callee-body rule. A call at a cycle
// member's top level is admitted when the callee's body provably runs
// only builtins, so a callee that READS A PARTNER'S BINDING must keep
// the fence.
//
// Rule 2 cannot catch this one: `aSeed` is used only inside a function
// body, which is a deferred position, so the back-edge check passes. The
// read still happens during the init window, because that function is
// CALLED at b's top level -- and b evaluates first, while a has not run
// a line. Node throws ReferenceError here; scriptc must refuse rather
// than pick an order.
import { run } from "./a.ts";

run();
