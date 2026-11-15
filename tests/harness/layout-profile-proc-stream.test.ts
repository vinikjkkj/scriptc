/* A PROFILED LINK OF A SPLIT PROGRAM THAT ONLY NAMES A PROCESS STREAM TYPE.
 *
 * The zapo postgres bench failed `scriptc build --layout-profile` with `undefined reference to scr_proc_stream_box`: the program emits a to-dyn
 * converter for a type that mentions a process stream, nothing boxes process.stdout, so the IR gate (procDyn) was false and scr_proc_dyn.c was not
 * linked. A plain link garbage-collects the never-called converter, so the plain build was fine; the coverage-instrumented link keeps every
 * function, and the converter's reference to the missing unit failed the link. The gate now also reads the emitted text.
 *
 *   plain build    -- links and runs, same output as Node (the control: this always worked);
 *   profiled build -- links, runs, same output, and writes the profile (the defect);
 *   both with SCRIPTC_SPLIT_PARTS=3, because the converter must live in a non-static function shared between parts.
 *
 * The program lives in a tmpdir with the repo's @types/node beside it (the stream type only maps to the process-stream kind with the real node
 * types; the ambient fallback has a different `process.stdout`). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const linux = process.platform === "linux";
const repoNodeTypes = join(import.meta.dirname, "../..", "node_modules/@types/node");

const SRC = `// the converter for Sink names the process-stream box; nothing ever boxes process.stdout
interface Sink {
  out: NodeJS.WriteStream
  n: number
}
function wrap(s: Sink): any {
  return s
}
function never(flag: boolean): any {
  if (flag) return wrap({ out: process.stdout, n: 1 })
  return null
}
console.log(typeof wrap, never(false))
`;

describe.skipIf(!linux)("a split program that only names a process stream type", () => {
  let dir = "";
  let main = "";
  let plain = "";
  let prof = "";

  async function build(layoutProfile: boolean): Promise<string> {
    const saved = process.env["SCRIPTC_SPLIT_PARTS"];
    process.env["SCRIPTC_SPLIT_PARTS"] = "3";
    try {
      const r = await compile(main, {
        outPath: join(dir, layoutProfile ? "prog-prof" : "prog-plain"),
        outDir: dir,
        backend: "c",
        ...(layoutProfile ? { layoutProfile: true } : {}),
      });
      if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      return r.binaryPath;
    } finally {
      if (saved === undefined) delete process.env["SCRIPTC_SPLIT_PARTS"];
      else process.env["SCRIPTC_SPLIT_PARTS"] = saved;
    }
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "scr-lp-procstream-"));
    mkdirSync(join(dir, "node_modules/@types"), { recursive: true });
    symlinkSync(repoNodeTypes, join(dir, "node_modules/@types/node"), "junction");
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true } }));
    main = join(dir, "main.ts");
    writeFileSync(main, SRC);
    plain = await build(false);
    prof = await build(true);
  }, 600_000);

  test("control: the plain build links and prints what Node prints", () => {
    const want = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main], { encoding: "utf8", timeout: 120_000 });
    expect(want).toBe("function null\n");
    expect(execFileSync(plain, [], { encoding: "utf8" })).toBe(want);
  });

  test("the profiled build links, prints the same and writes the profile", () => {
    const out = join(dir, "proc-stream.profile");
    rmSync(out, { force: true });
    expect(execFileSync(prof, [], { encoding: "utf8", env: { ...process.env, SCR_LAYOUT_PROFILE_OUT: out } })).toBe("function null\n");
    expect(readFileSync(out, "utf8").startsWith("# scr-layout-profile 1 ")).toBe(true);
  });
});
