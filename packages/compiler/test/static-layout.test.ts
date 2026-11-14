/* The static code layout (ir/static-layout.ts): tiers from the call graph alone. The modules are minimal IR: only names, `body` and `entry` are read. */
import { describe, expect, it } from "vitest";
import { STATIC_ERROR, STATIC_HOT, STATIC_MID, STATIC_STARTUP, staticLayoutRanks, staticLayoutTiers } from "../src/ir/static-layout.js";
import type { IrModule } from "../src/ir/nodes.js";

const call = (callee: string) => ({ kind: "exprStmt", expr: { kind: "call", callee, args: [] } });
const closure = (fnName: string) => ({ kind: "exprStmt", expr: { kind: "closure", fnName, captures: [] } });
const fn = (name: string, body: unknown[]) => ({ name, body });
const mod = (functions: unknown[], entry = "%main"): IrModule => ({ functions, entry }) as unknown as IrModule;

describe("staticLayoutRanks", () => {
  const m = mod([
    fn("parseConfig", []),
    fn("setup", [call("parseConfig")]),
    fn("leaf", []),
    fn("handlerWork", [call("leaf")]),
    fn("%fn.a.0", [call("handlerWork"), { kind: "tryCatch", tryBody: [], catchBody: [call("onlyInCatch")], catchLocalId: null, finallyBody: null }]),
    fn("onlyInCatch", []),
    fn("neverReached", []),
    fn("%init.0", [call("setup"), closure("%fn.a.0")]),
    fn("%main", [call("%init.0")]),
  ]);
  const r = staticLayoutRanks(m)!;
  it("puts what a handler reaches first, in DFS order from the handler", () => {
    expect(r.get("%fn.a.0")).toBe(STATIC_HOT);
    expect(r.get("handlerWork")).toBe(STATIC_HOT + 1);
    expect(r.get("leaf")).toBe(STATIC_HOT + 2);
  });
  it("puts what only the init tree reaches in the startup tier, behind the unknown", () => {
    expect(r.get("setup")! >= STATIC_STARTUP && r.get("setup")! < STATIC_ERROR).toBe(true);
    expect(r.get("parseConfig")! >= STATIC_STARTUP).toBe(true);
    expect(r.get("%main")! >= STATIC_STARTUP).toBe(true);
    expect(r.get("neverReached")! >= STATIC_MID && r.get("neverReached")! < STATIC_STARTUP).toBe(true);
  });
  it("puts what only a catch body calls last", () => {
    expect(r.get("onlyInCatch")! >= STATIC_ERROR).toBe(true);
  });
  it("a function reached from a handler is hot even when startup also calls it", () => {
    const shared = mod([fn("shared", []), fn("%fn.h.0", [call("shared")]), fn("%init.0", [call("shared"), closure("%fn.h.0")]), fn("%main", [call("%init.0")])]);
    expect(staticLayoutRanks(shared)!.get("shared")).toBeLessThan(STATIC_MID);
  });
  it("counts the tiers, loses no function and ranks every one", () => {
    const t = staticLayoutTiers(r);
    expect(t.hot + t.mid + t.startup + t.error).toBe(m.functions.length);
    expect(r.size).toBe(m.functions.length);
  });
  it("is off with SCRIPTC_STATIC_LAYOUT=0 and for a module of one function", () => {
    process.env["SCRIPTC_STATIC_LAYOUT"] = "0";
    try { expect(staticLayoutRanks(m)).toBeUndefined(); } finally { delete process.env["SCRIPTC_STATIC_LAYOUT"]; }
    expect(staticLayoutRanks(mod([fn("%main", [])]))).toBeUndefined();
  });
  it("does not read a literal's text as a function name", () => {
    const lit = mod([fn("setup", []), fn("%main", [{ kind: "exprStmt", expr: { kind: "strLit", value: "setup" } }])]);
    expect(staticLayoutRanks(lit)!.get("setup")! >= STATIC_MID).toBe(true);
  });
});
