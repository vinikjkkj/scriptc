/* A function-typed member read as a VALUE, in a module that runs engine code.
 *
 * A record cast of an engine-held object (zapo's type cast field: buffer(), string(), geometry()) holds each method as an adapter BOUND to
 * its receiver, so the call `field.buffer()` - the only way the member is used in practice - runs the engine's `field.buffer()`. Node
 * reads the member as the engine's own function object, unbound: `const f = field.buffer; f()` calls with `this` undefined, and
 * `field.buffer === field.buffer` is the same object every time. A member read that is not the callee of a call is therefore wrapped in
 * `fn.unbind`, which answers the adapter of the engine function itself (remembered, so the same function is the same value); a call keeps
 * the bound adapter and pays nothing. Only a module that runs engine code is rewritten, so every other program emits what it always did. */
import { moduleUsesEngineFn, type IrExpr, type IrModule } from "../../ir/nodes.js";

export function unbindEngineMemberReads(mod: IrModule): void {
  if (!moduleUsesEngineFn(mod)) return;
  const wrap = (e: IrExpr): IrExpr =>
    ({ kind: "libCall", fn: "fn.unbind", args: [e], type: e.type, loc: (e as { loc: IrExpr["loc"] }).loc }) as IrExpr;
  const isFuncRead = (v: unknown): v is IrExpr =>
    v !== null && typeof v === "object" && (v as { kind?: unknown }).kind === "recordGet" && (v as { type?: { kind?: unknown } }).type?.kind === "func";
  // Iterative: a module can be arbitrarily deep.
  const stack: unknown[] = [mod.functions];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const c = node[i];
        if (isFuncRead(c)) node[i] = wrap(c);
        stack.push(c); // the wrapped node's own children still need their turn
      }
      continue;
    }
    const o = node as Record<string, unknown>;
    const isCall = o["kind"] === "callValue";
    for (const key of Object.keys(o)) {
      const c = o[key];
      if (isFuncRead(c) && !(isCall && key === "callee")) o[key] = wrap(c);
      stack.push(c);
    }
  }
}
