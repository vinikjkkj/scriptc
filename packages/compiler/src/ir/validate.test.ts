/* The validator's diagnostic for a call to a method reachability removed.
 *
 * A class method is emitted as the module function `%C.m`, and module assembly
 * prunes BOTH the function and the def's method entry unless the lowering of a
 * call site noted an edge for it. Get that wrong and the method disappears with
 * no complaint where the mistake is; the build dies later at the call, on a name
 * that looks like it plainly ought to exist. These tests pin the message that
 * names the actual cause, and -- the point of them -- pin that it does NOT
 * appear on the neighbouring cases it would be wrong about. */

import { describe, expect, it } from "vitest";
import { F64, type IrClassDef, type IrExpr, type IrFunction, type IrModule, type SrcLoc } from "./nodes.js";
import { validateModule } from "./validate.js";

const LOC: SrcLoc = { file: "t.ts", start: 0, end: 0 };

function callTo(callee: string): IrExpr {
  return { kind: "call", callee, args: [], type: F64, loc: LOC };
}

function moduleWith(opts: { callee: string; classes?: IrClassDef[]; extra?: IrFunction[] }): IrModule {
  const entry: IrFunction = {
    name: "main",
    params: [],
    returnType: { kind: "void" },
    locals: [],
    body: [{ kind: "exprStmt", expr: callTo(opts.callee), loc: LOC }],
    loc: LOC,
  };
  return {
    irVersion: 3,
    sourceFile: "t.ts",
    entry: "main",
    functions: [entry, ...(opts.extra ?? [])],
    ...(opts.classes ? { classes: opts.classes } : {}),
  };
}

const classC = (methods?: string[]): IrClassDef => ({
  name: "C",
  fields: [],
  ...(methods ? { methods } : {}),
  loc: LOC,
});

function messages(mod: IrModule): string {
  return validateModule(mod).map((e) => e.message).join("\n");
}

describe("call to a pruned class method", () => {
  it("names reachability as the cause when the class is emitted without the method", () => {
    const m = messages(moduleWith({ callee: "%C.m", classes: [classC()] }));
    expect(m).toContain('call to undeclared function "%C.m"');
    expect(m).toContain('class "C" is emitted but carries no method "m"');
    expect(m).toContain("no call site noted an edge");
  });

  it("splits a namespaced class on the LAST dot", () => {
    // Classes hoist under namespace-qualified names, so `%ns.C.m` is class
    // `ns.C` and method `m` -- not class `ns` and method `C.m`.
    const nsC: IrClassDef = { name: "ns.C", fields: [], loc: LOC };
    const m = messages(moduleWith({ callee: "%ns.C.m", classes: [nsC] }));
    expect(m).toContain('class "ns.C" is emitted but carries no method "m"');
  });

  it("stays silent when the class DOES carry the method", () => {
    // Then the fault is a missing function, not a pruned edge, and this hint
    // would send the reader after the wrong cause.
    const m = messages(moduleWith({ callee: "%C.m", classes: [classC(["m"])] }));
    expect(m).toContain('call to undeclared function "%C.m"');
    expect(m).not.toContain("noted an edge");
  });

  it("stays silent when the module carries no such class", () => {
    const m = messages(moduleWith({ callee: "%C.m" }));
    expect(m).toContain('call to undeclared function "%C.m"');
    expect(m).not.toContain("noted an edge");
  });

  it("stays silent for an ordinary undeclared function", () => {
    const m = messages(moduleWith({ callee: "helper", classes: [classC()] }));
    expect(m).toContain('call to undeclared function "helper"');
    expect(m).not.toContain("noted an edge");
  });
});
