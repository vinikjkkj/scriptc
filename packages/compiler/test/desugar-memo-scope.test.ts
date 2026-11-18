/* THE DESUGAR MEMO IS ONE COMPILE'S, NOT THE PROCESS'S.
 *
 * jsDesugar rewrites a TypeScript-compiled CommonJS `__exportStar(require("./dep"), exports)` into explicit `exports.<name> = ...` copies, and WHICH names
 * it copies is read from the DISK file `./dep`, not from the text being desugared. The desugar memo (ts7/program.ts) keeps a big file's answer so the
 * reloads of one compile do not redo it; its key is the file name and the file's own text, so it must live no longer than ONE compile: a second compile in
 * the same process (the test workers, a watch loop) can meet the same big file text beside a different `./dep`, and must get its own answer.
 *
 * THE DISCRIMINATING TEST compiles two programs in ONE process whose `big.js` is byte-identical (padded past the memo's size floor) and whose `dep.js`
 * differs. With a process-wide memo the second load answers the first one's text; with a per-compile memo it answers its own. It was shown RED on the
 * process-wide memo and GREEN on the per-compile one. THE POSITIVE CONTROL is the same test's second half: two loads that SHARE one memo object (one compile)
 * must hit it, so the memo is shown to be live and the green above is not "the memo never engaged". */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { DesugarMemo } from "../src/frontend/ts7/program.js";

const BIG = [
  '"use strict";',
  "var __createBinding = (this && this.__createBinding) || Object.create;",
  'var __exportStar = (this && this.__exportStar) || function(m, exports) { for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p); };',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  '__exportStar(require("./dep.js"), exports);',
  "// " + "x".repeat(120_000),
  "",
].join("\n");

function program(dir: string, depBody: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "big.js"), BIG);
  writeFileSync(join(dir, "dep.js"), depBody);
  writeFileSync(join(dir, "main.ts"), 'import * as big from "./big.js";\nconsole.log(Object.keys(big).length);\n');
  return join(dir, "main.ts");
}

function desugaredBig(entry: string, opts?: { desugarMemo?: DesugarMemo }): string {
  const load = loadProgram(entry, opts);
  try {
    const sf = load.program.getSourceFiles().find((f) => f.fileName.endsWith("/big.js"));
    return sf === undefined ? "" : sf.text;
  } finally {
    load.dispose();
  }
}

test("two compiles in one process get their own desugar of the same big file", { timeout: 240_000 }, () => {
  // ONE directory, so the big file has the same name and the same text in both compiles; only the neighbour it reads from disk changes.
  const dir = join(mkdtempSync(join(tmpdir(), "scr-desugar-memo-")), "p");
  const first = desugaredBig(program(dir, "exports.alpha = 1;\n"));
  const second = desugaredBig(program(dir, "exports.beta = 2;\n"));
  expect(first).toContain("exports.alpha =");
  expect(first).not.toContain("exports.beta =");
  expect(second).toContain("exports.beta =");
  expect(second).not.toContain("exports.alpha =");
});

test("loads of ONE compile share the memo (the positive control: it is live)", { timeout: 240_000 }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), "scr-desugar-memo-")), "p");
  const memo = new DesugarMemo();
  const entry = program(dir, "exports.alpha = 1;\n");
  const first = desugaredBig(entry, { desugarMemo: memo });
  expect(memo.size).toBeGreaterThan(0);
  // The neighbour changes under the SAME memo: the hit is the stale answer, which is exactly why a memo may not outlive its compile.
  writeFileSync(join(dir, "dep.js"), "exports.beta = 2;\n");
  const second = desugaredBig(entry, { desugarMemo: memo });
  expect(second).toBe(first);
  // And a load of the next compile (a fresh memo) answers its own.
  const third = desugaredBig(entry, { desugarMemo: new DesugarMemo() });
  expect(third).toContain("exports.beta =");
});
