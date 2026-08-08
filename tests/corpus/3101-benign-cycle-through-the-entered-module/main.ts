/* The cycle a → b → a where the ONLY non-inert top level belongs to the
 * module the walk ENTERS the component through (a.ts's `console.log("a-init",
 * aye(2))`). ES bodies evaluate in DFS postorder, so a.ts runs LAST of the
 * two: b.ts is fully initialized before a.ts's top-level call reaches `bee`,
 * and nothing observes a partial initialization.
 *
 * This lived in tests/diagnostics as the SC1016 case "top-level code at
 * a.ts:5 can run user code during the cycle's init window" until the
 * admission engine learned the entered-module exemption. It compiles now,
 * so a diagnostics fixture is the wrong home for it: the claim worth
 * gating is that the compiled program agrees with Node, which is what the
 * corpus checks and a snapshot of a refusal never did. */
import { aye } from "./a.ts";
console.log(aye(5));
