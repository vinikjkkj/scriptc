/* The embedded engine's link gate (moduleUsesEngineFn, ir/nodes.ts): QuickJS is linked only into a program that can RUN text on it (eval, new
 * Function, a call of the Function constructor value reached through a prototype). Reading, testing and comparing a prototype's `constructor`,
 * a dynamic call and regular expressions never needed it, and used to link and boot it.
 *
 * The positive control is the symbol: the row that only reads constructors must carry no JS_NewRuntime in its binary, and the row that calls the
 * Function constructor value must carry it AND print Node's answers (so the gate is not over-narrowed). A Windows PE has no symbol table, so there
 * the check is the size gap the engine makes (it adds several hundred KB). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const corpus = join(repoRoot, "tests/corpus");
const rowOf = (prefix: string): string => readdirSync(corpus).find((n) => n.startsWith(prefix))!;
const noEngineRow = rowOf("24960-");
const engineRow = rowOf("24961-");

let work = "";
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "scriptc-engine-gate-"));
});

async function build(name: string, backend: "c" | "llvm", file: string): Promise<{ bin: string; size: number }> {
  const dir = join(work, `${name}-${backend}`);
  mkdirSync(dir, { recursive: true });
  const src = join(dir, file);
  writeFileSync(src, readFileSync(join(corpus, file)));
  const built = await compile(src, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  expect(built.ok, (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n")).toBe(true);
  return { bin: built.binaryPath!, size: statSync(built.binaryPath!).size };
}

function hasEngineSymbol(bin: string): boolean {
  return readFileSync(bin).includes(Buffer.from("JS_NewRuntime"));
}

describe.each(["c", "llvm"] as const)("the engine link gate (%s)", (backend) => {
  test("a program that only reads prototype constructors, calls dynamically and uses regexes carries no engine, and one that calls the Function constructor value does", async () => {
    const plain = await build("plain", backend, noEngineRow);
    const withEngine = await build("engine", backend, engineRow);
    if (process.platform !== "win32") {
      expect(hasEngineSymbol(plain.bin), "the constructor-reading row linked the engine").toBe(false);
      expect(hasEngineSymbol(withEngine.bin), "the Function-constructor-calling row did not link the engine (the gate is over-narrowed)").toBe(true);
    }
    expect(withEngine.size - plain.size).toBeGreaterThan(300_000);
    // The engine row runs on the engine and prints Node's text.
    const out = execFileSync(withEngine.bin, [], { encoding: "utf8" });
    expect(out).toBe("7 42\n11\n5\n42\n");
  }, 900_000);
});
