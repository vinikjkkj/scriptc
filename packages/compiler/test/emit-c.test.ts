import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { emitModule } from "../src/backend/emission/emitter.js";
import { compileC, resolveCc } from "../src/backend/cc.js";
import { validateModule } from "../src/ir/validate.js";
import { fibModule } from "./fixtures/fib-ir.js";
import { BOOL, F64, STRING, VOID, type IrExpr, type IrModule } from "../src/ir/nodes.js";

const execFileAsync = promisify(execFile);

/* Windows will not exec an extensionless file (libuv's lpApplicationName
 * assumes no default extension) and compileC writes exactly the -o name it
 * is given — so anything spawned below must ask for the suffix. Spelled
 * inline rather than imported: tests/harness/exe.ts carries the full
 * explanation but lives in another package. */
const EXE = process.platform === "win32" ? ".exe" : "";

/* -DSCR_RC_AUDIT and -fsanitize=address are SEPARATE dials (cc.ts's
 * rcAuditRequested comment), and the reason they were split is the very
 * toolchain this file used to die on: zig's mingw target compiles ASan
 * instrumentation and then has no asan runtime to link it against, so every
 * test here failed at `lld-link: error: undefined symbol: __asan_memcpy` —
 * four red tests that never once ran the emitted program. The audit define
 * is pure C and links everywhere, so the RC-cleanliness half of the claim
 * survives on a box where the sanitizer cannot; only the memory-error half
 * is lost, and it is lost LOUDLY. */
let asanProbe: Promise<boolean> | undefined;
function asanLinks(): Promise<boolean> {
  return (asanProbe ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-emit-asan-"));
    const c = join(dir, "p.c");
    await writeFile(c, "int main(void){return 0;}\n");
    const d = resolveCc(process.env);
    try {
      await execFileAsync(d.argv[0]!, [
        ...d.argv.slice(1), ...d.targetArgs,
        "-fsanitize=address", "-o", join(dir, `p${EXE}`), c, ...d.linkArgs,
      ]);
      return true;
    } catch {
      console.warn(
        `[emit-c] ${d.argv.join(" ")} cannot link -fsanitize=address here; building these programs ` +
          `UNSANITIZED with SCRIPTC_RC_AUDIT=1. Refcount leaks are still caught, memory errors are not.`,
      );
      return false;
    }
  })());
}

async function emitCompileRun(mod: IrModule, sanitize = true): Promise<string> {
  expect(validateModule(mod)).toEqual([]);
  const dir = await mkdtemp(join(tmpdir(), "scriptc-emit-"));
  const cPath = join(dir, "program.c");
  await writeFile(cPath, emitModule(mod));
  const outPath = join(dir, `program${EXE}`);
  const asan = sanitize && (await asanLinks());
  const prev = process.env["SCRIPTC_RC_AUDIT"];
  if (sanitize && !asan) process.env["SCRIPTC_RC_AUDIT"] = "1";
  try {
    await compileC({ cPath, outPath, sanitize: asan });
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_RC_AUDIT"];
    else process.env["SCRIPTC_RC_AUDIT"] = prev;
  }
  const { stdout } = await execFileAsync(outPath);
  // C's printf("\n") is CRLF on a Windows stdio stream (CRT text-mode
  // translation), which is not something the emitter chose.
  return stdout.split("\r\n").join("\n");
}

test("hand-built fib IR compiles and prints 55", async () => {
  expect(await emitCompileRun(fibModule)).toBe("55\n");
});

test("strings: literals, concat in a loop, toString, RC-clean under audit", async () => {
  const loc = { file: "s.ts", start: 0, end: 0 };
  const str = (value: string): IrExpr => ({ kind: "strLit", value, type: STRING, loc });
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  // let acc = "x"; let i = 0;
  // while (i < 3) { acc = acc + ("-" + i); i = i + 1; }
  // console.log(acc, acc === "x-0-1-2", "α∂" < "β");
  const mod: IrModule = {
    irVersion: 3,
    sourceFile: "s.ts",
    entry: "__main",
    functions: [
      {
        name: "__main",
        params: [],
        returnType: VOID,
        locals: [
          { id: "acc.0", name: "acc", type: STRING, mutable: true },
          { id: "i.0", name: "i", type: F64, mutable: true },
        ],
        body: [
          { kind: "varDecl", localId: "acc.0", init: str("x"), loc },
          { kind: "varDecl", localId: "i.0", init: num(0), loc },
          {
            kind: "while",
            cond: {
              kind: "bin", op: "<",
              left: { kind: "varRef", localId: "i.0", type: F64, loc },
              right: num(3), type: BOOL, loc,
            },
            body: [
              {
                kind: "assign",
                localId: "acc.0",
                value: {
                  kind: "strConcat",
                  left: { kind: "varRef", localId: "acc.0", type: STRING, loc },
                  right: {
                    kind: "strConcat",
                    left: str("-"),
                    right: { kind: "toString", operand: { kind: "varRef", localId: "i.0", type: F64, loc }, type: STRING, loc },
                    type: STRING, loc,
                  },
                  type: STRING, loc,
                },
                loc,
              },
              {
                kind: "assign",
                localId: "i.0",
                value: { kind: "bin", op: "+", left: { kind: "varRef", localId: "i.0", type: F64, loc }, right: num(1), type: F64, loc },
                loc,
              },
            ],
            loc,
          },
          {
            kind: "exprStmt",
            expr: {
              kind: "intrinsic",
              name: "console.log",
              args: [
                { kind: "varRef", localId: "acc.0", type: STRING, loc },
                { kind: "strEq", negated: false, left: { kind: "varRef", localId: "acc.0", type: STRING, loc }, right: str("x-0-1-2"), type: BOOL, loc },
                { kind: "strCmp", op: "<", left: str("α∂"), right: str("β"), type: BOOL, loc },
              ],
              type: VOID,
              loc,
            },
            loc,
          },
        ],
        loc,
      },
    ],
  };
  expect(await emitCompileRun(mod)).toBe("x-0-1-2 true true\n");
});

test("short-circuit: right operand of && only evaluates when left is true", async () => {
  const loc = { file: "l.ts", start: 0, end: 0 };
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  // function sideEffect(): boolean { console.log("evaluated"); return true; }
  // if (false && sideEffect()) {} ; if (true || sideEffect()) {}
  // console.log("done")
  const mod: IrModule = {
    irVersion: 3,
    sourceFile: "l.ts",
    entry: "__main",
    functions: [
      {
        name: "sideEffect",
        params: [],
        returnType: BOOL,
        locals: [],
        body: [
          { kind: "exprStmt", expr: { kind: "intrinsic", name: "console.log", args: [{ kind: "strLit", value: "evaluated", type: STRING, loc }], type: VOID, loc }, loc },
          { kind: "return", value: { kind: "boolLit", value: true, type: BOOL, loc }, loc },
        ],
        loc,
      },
      {
        name: "__main",
        params: [],
        returnType: VOID,
        locals: [],
        body: [
          {
            kind: "if",
            cond: { kind: "logical", op: "&&", left: { kind: "boolLit", value: false, type: BOOL, loc }, right: { kind: "call", callee: "sideEffect", args: [], type: BOOL, loc }, type: BOOL, loc },
            then: [{ kind: "exprStmt", expr: { kind: "intrinsic", name: "console.log", args: [num(1)], type: VOID, loc }, loc }],
            else_: null,
            loc,
          },
          {
            kind: "if",
            cond: { kind: "logical", op: "||", left: { kind: "boolLit", value: true, type: BOOL, loc }, right: { kind: "call", callee: "sideEffect", args: [], type: BOOL, loc }, type: BOOL, loc },
            then: [{ kind: "exprStmt", expr: { kind: "intrinsic", name: "console.log", args: [{ kind: "strLit", value: "done", type: STRING, loc }], type: VOID, loc }, loc }],
            else_: null,
            loc,
          },
        ],
        loc,
      },
    ],
  };
  expect(await emitCompileRun(mod)).toBe("done\n");
});

test("string params: callee owns and releases; returns transfer ownership", async () => {
  const loc = { file: "p.ts", start: 0, end: 0 };
  // function greet(who: string): string { return "hi " + who; }
  // console.log(greet("world"));
  const mod: IrModule = {
    irVersion: 3,
    sourceFile: "p.ts",
    entry: "__main",
    functions: [
      {
        name: "greet",
        params: [{ localId: "who.0", name: "who", type: STRING }],
        returnType: STRING,
        locals: [{ id: "who.0", name: "who", type: STRING, mutable: false }],
        body: [
          {
            kind: "return",
            value: {
              kind: "strConcat",
              left: { kind: "strLit", value: "hi ", type: STRING, loc },
              right: { kind: "varRef", localId: "who.0", type: STRING, loc },
              type: STRING, loc,
            },
            loc,
          },
        ],
        loc,
      },
      {
        name: "__main",
        params: [],
        returnType: VOID,
        locals: [],
        body: [
          {
            kind: "exprStmt",
            expr: {
              kind: "intrinsic",
              name: "console.log",
              args: [{ kind: "call", callee: "greet", args: [{ kind: "strLit", value: "world", type: STRING, loc }], type: STRING, loc }],
              type: VOID, loc,
            },
            loc,
          },
        ],
        loc,
      },
    ],
  };
  expect(await emitCompileRun(mod)).toBe("hi world\n");
});
