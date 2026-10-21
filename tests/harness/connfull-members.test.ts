/* mysql2's `Connection` (and PoolConnection / Pool) is a body-less `declare
 * class` whose members the record shape used to EXCLUDE when they were
 * generic, overloaded, optional-generic or took a standard-library
 * constructor. Excluding a member is best effort: a program that names it is
 * refused although the type "maps". Each test below pins ONE mechanism that
 * lets a family of members map and be CALLED natively, as a differential:
 * the same TypeScript runs on the test's own node (type-stripped, the only
 * oracle that cannot disagree with itself) and as a compiled binary, and the
 * output must be identical. No mysql2 is needed: the local .d.ts spells the
 * same member shapes, and the program builds the value structurally (a static
 * build has no other producer of a value of a non-program class). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

async function differential(label: string, dts: string, src: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `scr-connfull-${label}-`));
  writeFileSync(join(dir, "declib.d.ts"), dts);
  const main = join(dir, "main.ts");
  writeFileSync(main, src);
  const exe = process.platform === "win32" ? ".exe" : "";
  const result = await compile(main, { outPath: join(dir, `prog${exe}`), outDir: dir });
  if (!result.ok) {
    throw new Error(`expected ${label} to compile; got:\n` + result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  const want = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const got = execFileSync(result.binaryPath, { encoding: "utf8", timeout: 120_000 });
  expect(got).toBe(want);
  expect(got.length).toBeGreaterThan(0);
}

describe("a body-less .d.ts class: every member is a slot the program can call", () => {
  test("a listener slot spelled `(...args: any[]) => void` takes typed closures through the dyn pack", async () => {
    await differential(
      "listener",
      `export declare class Conn {
  threadId: number;
  on(event: string, listener: (...args: any[]) => void): this;
}
`,
      `import type { Conn } from "./declib.js";
const seen: string[] = [];
const c: Conn = {
  threadId: 3,
  on(event: string, listener: (...args: unknown[]) => void): Conn {
    listener(1, "a");
    return c;
  },
};
c.on("x", (n: number) => console.log("got", n));
c.on("two", (n: number, s: string) => console.log("two", n, s));
c.on("none", () => console.log("none"));
console.log(c.threadId, seen.length);
`,
    );
  }, 240_000);
});
