import { expect, test } from "vitest";
import { validateModule } from "../src/ir/validate.js";
import { deserializeModule, serializeModule } from "../src/ir/serialize.js";
import { fibModule } from "./fixtures/fib-ir.js";
import { BOOL, DYN, F64, type IrExpr, type IrModule } from "../src/ir/nodes.js";

test("hand-built fib module validates", () => {
  expect(validateModule(fibModule)).toEqual([]);
});

test("fib module JSON round-trips", () => {
  const json = serializeModule(fibModule);
  expect(deserializeModule(json)).toEqual(fibModule);
});

test("validator rejects type mismatches and bad references", () => {
  const loc = { file: "t.ts", start: 0, end: 0 };
  const bad: IrModule = {
    irVersion: 3,
    sourceFile: "t.ts",
    entry: "__main",
    functions: [
      {
        name: "__main",
        params: [],
        returnType: { kind: "void" },
        locals: [{ id: "x.0", name: "x", type: F64, mutable: false }],
        body: [
          // init type mismatch: bool into f64 local
          { kind: "varDecl", localId: "x.0", init: { kind: "boolLit", value: true, type: BOOL, loc }, loc },
          // undeclared local
          { kind: "assign", localId: "y.0", value: { kind: "numLit", value: 1, type: F64, loc }, loc },
          // assign to immutable
          { kind: "assign", localId: "x.0", value: { kind: "numLit", value: 1, type: F64, loc }, loc },
          // call to unknown function
          { kind: "exprStmt", expr: { kind: "call", callee: "nope", args: [], type: F64, loc }, loc },
        ],
        loc,
      },
    ],
  };
  const errors = validateModule(bad).map((e) => e.message);
  expect(errors).toEqual([
    expect.stringContaining('init: expected f64, got bool'),
    expect.stringContaining('undeclared local/global "y.0"'),
    expect.stringContaining('immutable local "x"'),
    expect.stringContaining('undeclared function "nope"'),
  ]);
});

/* dynArrLit's SPREAD INDEX is the one list in this IR whose arity is a
 * run-time fact, so an out-of-range or duplicated index is not a typo —
 * it silently drops or duplicates an ARGUMENT. The validator has to fire
 * on both, and this test is the proof that it does rather than the claim
 * that it should: the CONTROL below builds the same node with valid
 * indices and must validate clean, so a validator that answered "error"
 * for everything could not pass here. */
test("validator rejects out-of-range and duplicated dynArrLit spread indices", () => {
  const loc = { file: "t.ts", start: 0, end: 0 };
  const elem = (): IrExpr => ({
    kind: "dynFrom",
    value: { kind: "numLit", value: 1, type: F64, loc },
    type: DYN,
    loc,
  });
  const moduleWith = (spreads: { at: number; what: string | null }[]): IrModule => ({
    irVersion: 3,
    sourceFile: "t.ts",
    entry: "__main",
    functions: [
      {
        name: "__main",
        params: [],
        returnType: { kind: "void" },
        locals: [{ id: "p.0", name: "p", type: DYN, mutable: false }],
        body: [
          {
            kind: "varDecl",
            localId: "p.0",
            init: { kind: "dynArrLit", elems: [elem(), elem()], spreads, type: DYN, loc },
            loc,
          },
        ],
        loc,
      },
    ],
    globals: [],
    recordShapes: [],
    unions: [],
  });

  // CONTROL: the same node with both indices in range validates clean.
  expect(validateModule(moduleWith([{ at: 0, what: "xs" }, { at: 1, what: null }]))).toEqual([]);

  const past = validateModule(moduleWith([{ at: 2, what: "xs" }])).map((e) => e.message);
  expect(past).toEqual([expect.stringContaining("spread index 2 out of range (2 elements)")]);

  const negative = validateModule(moduleWith([{ at: -1, what: "xs" }])).map((e) => e.message);
  expect(negative).toEqual([expect.stringContaining("spread index -1 out of range")]);

  const fractional = validateModule(moduleWith([{ at: 0.5, what: "xs" }])).map((e) => e.message);
  expect(fractional).toEqual([expect.stringContaining("spread index 0.5 out of range")]);

  const twice = validateModule(moduleWith([{ at: 1, what: "xs" }, { at: 1, what: null }])).map((e) => e.message);
  expect(twice).toEqual([expect.stringContaining("spread index 1 listed twice")]);
});


test("serializer round-trips ±Infinity and refuses NaN", () => {
  const mod = structuredClone(fibModule);
  const fn = mod.functions[0]!;
  const stmt = fn.body[0]!;
  if (stmt.kind === "if" && stmt.cond.kind === "bin" && stmt.cond.right.kind === "numLit") {
    stmt.cond.right.value = Infinity;
  }
  const back = deserializeModule(serializeModule(mod));
  const stmt2 = back.functions[0]!.body[0]!;
  if (stmt2.kind === "if" && stmt2.cond.kind === "bin" && stmt2.cond.right.kind === "numLit") {
    expect(stmt2.cond.right.value).toBe(Infinity);
  } else {
    throw new Error("round-trip lost the statement shape");
  }
  if (stmt.kind === "if" && stmt.cond.kind === "bin" && stmt.cond.right.kind === "numLit") {
    stmt.cond.right.value = -Infinity;
  }
  const back2 = deserializeModule(serializeModule(mod));
  const stmt3 = back2.functions[0]!.body[0]!;
  if (stmt3.kind === "if" && stmt3.cond.kind === "bin" && stmt3.cond.right.kind === "numLit") {
    expect(stmt3.cond.right.value).toBe(-Infinity);
  }
  if (stmt.kind === "if" && stmt.cond.kind === "bin" && stmt.cond.right.kind === "numLit") {
    stmt.cond.right.value = NaN;
  }
  expect(() => serializeModule(mod)).toThrow(/NaN/);
});

test("deserializer enforces IR version", () => {
  const json = serializeModule(fibModule).replace('"irVersion": 3', '"irVersion": 99');
  expect(() => deserializeModule(json)).toThrow(/version mismatch/);
});
