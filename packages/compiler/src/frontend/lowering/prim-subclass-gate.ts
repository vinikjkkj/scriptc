/* Program-level gate for primitive-wrapper subclasses (prim-subclass-desugar.ts). */
import type { Lowerer } from "./lowerer.js";

const memo = new WeakMap<object, boolean>();

/** Does any source file of the program carry the primitive-subclass rewrite's reserved call (`__scrSuperString(` and its Number /
 * Boolean siblings, authored only by the desugar)? Decided once per program from the files' text. Every lowering that must answer
 * differently only when such a wrapper can exist asks this, so a program without one lowers exactly as before. */
export function programHasPrimSubclass(L: Lowerer): boolean {
  let r = memo.get(L.program);
  if (r === undefined) {
    r = false;
    for (const sf of L.program.getSourceFiles()) {
      if (!sf.isDeclarationFile && sf.text.includes("__scrSuper")) { r = true; break; }
    }
    memo.set(L.program, r);
  }
  return r;
}
