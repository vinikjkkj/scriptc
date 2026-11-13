/* OWNXFER TRIPWIRE. The dead-source pass (ir/dead-source.ts) lets a typed-array crossing skip its origin mark when the local is read only
 * there. In a --sanitize (audit) build the local is then replaced by a tombstone, and any later read aborts with an "ownxfer:" message --
 * so a wrong verdict is loud in every sanitized lane instead of a silently lost write.
 *
 *   normal build, used-after program  -- exact Node output, exit 0 (the pass does not mark a crossing whose local is read again);
 *   SCRIPTC_OWNXFER_FORCE=1 + sanitize -- the pass marks it anyway (the positive control): the program aborts with the tripwire message;
 *   SCRIPTC_OWNXFER_FORCE=1, plain    -- no abort, and the write is lost (the silent wrong answer the tripwire exists to catch).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const linux = process.platform === "linux";

async function build(tag: string, sanitize: boolean, force: boolean): Promise<string> {
  const dir = join(cacheDir, `ownxfer-${tag}`);
  mkdirSync(dir, { recursive: true });
  const prev = process.env["SCRIPTC_OWNXFER_FORCE"];
  if (force) process.env["SCRIPTC_OWNXFER_FORCE"] = "1";
  else delete process.env["SCRIPTC_OWNXFER_FORCE"];
  try {
    const result = await compile(join(repoRoot, "tests/fixtures/ownxfer/used-after.ts"), { outPath: join(dir, exeName("used-after")), outDir: dir, sanitize });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return result.binaryPath;
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_OWNXFER_FORCE"];
    else process.env["SCRIPTC_OWNXFER_FORCE"] = prev;
  }
}

describe.skipIf(!linux)("the ownxfer tripwire", () => {
  let normalSan = "";
  let forcedSan = "";
  let forcedPlain = "";
  beforeAll(async () => {
    normalSan = await build("normal-san", true, false);
    forcedSan = await build("forced-san", true, true);
    forcedPlain = await build("forced-plain", false, true);
  }, 600_000);

  test("a normal sanitized build of a used-after program matches Node and exits 0", () => {
    const out = execFileSync(normalSan, [], { encoding: "utf8" });
    expect(out).toBe("[1,2,3,99] [1,2,3,99]\n");
  });

  test("positive control: forcing the pass on the used-after crossing aborts the sanitized build with the tripwire message", () => {
    const r = spawnSync(forcedSan, [], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("ownxfer: a typed array was used after the compiler declared it dead");
  });

  test("the same forced pass in a plain build does not abort and silently loses the write", () => {
    const r = spawnSync(forcedPlain, [], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("[1,2,3,99] [1,2,3]\n");
  });
});
