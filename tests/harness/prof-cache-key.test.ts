/* THE BUILD CACHE MUST SEE A FORCED INCLUDE'S CONTENTS, NOT JUST ITS NAME.
 *
 * Every instrument in tests/perf — cycstat, cycensus, heapcensus, poolstat,
 * pagecensus — is a HEADER force-included through SCRIPTC_PROF_CFLAGS. The
 * flag string that names one does not change when the header is edited, and
 * the runtime fingerprint the build cache hashes covers packages/runtime and
 * the vendored tree only. So before this test existed, the two keyspaces
 * under SCRIPTC_CACHE_DIR — `bin/` (whole binaries) and `obj/` (per-flavor
 * runtime objects) — had every input identical across an instrument edit,
 * hit, and handed back a binary carrying the PREVIOUS instrument.
 *
 * MEASURED, not supposed. A page census was deliberately broken; the rebuilt
 * executable came out with the same sha256 as the one before the break and
 * printed the pre-break answer, and the harness test written to catch that
 * very break passed in 1.3 seconds. cc.ts's own profFlavor() already folds
 * the bytes of every -include'd file, and the comment above it describes
 * this exact defect one level down — it was wired into the five vendored
 * caches and never into these two.
 *
 * WHAT IS ASSERTED, and it is a pair on purpose. "A changed header gives a
 * different binary" alone is satisfied by a cache that never hits at all, so
 * the first assertion is that an UNCHANGED header gives a byte-identical
 * one — which is the cache doing its job and, incidentally, the build being
 * reproducible. Only against that control does the second assertion mean
 * what it says.
 *
 * AND IT IS BEHAVIOURAL, not only a hash. The edited header redefines
 * SCR_CYC_ARENA_CHUNK, so the arena carves 32 KiB chunks instead of 64 KiB
 * and cycstat's chunk count must move. A test that compared only file hashes
 * would pass on a build that differed by a timestamp; this one fails unless
 * the binary that ran was compiled from the header on disk.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cycstat = join(repoRoot, "tests/perf/cycstat/scr_cyc_stat.h").replace(/\\/g, "/");
const src = join(repoRoot, "tests/fixtures/cycle-arena/churn.ts");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const rcAudit = process.env["SCRIPTC_RC_AUDIT"] === "1";

/* The arena is compiled out under SCR_RC_AUDIT, and cc.ts splits
 * SCRIPTC_PROF_CFLAGS on whitespace so a path with a space cannot be named
 * through it. Either way this file says it cannot look. */
const work = join(repoRoot, "node_modules/.cache/scriptc-profcache");
const probe = join(work, "probe.h").replace(/\\/g, "/");
const armable = !rcAudit && !sanitize && !/\s/.test(cycstat) && !/\s/.test(probe);

/* v1 defines nothing the build reads; v2 halves the cycle arena's chunk.
 * Both are legal: scr_cycle.c static-asserts the chunk fits a block's
 * granule offset (<= 64 KiB) and holds a header zone (>= 1 KiB). */
const V1 = "/* profcache probe v1 - defines nothing */\n";
const V2 = "/* profcache probe v2 */\n#define SCR_CYC_ARENA_CHUNK ((size_t)32 << 10)\n";

const RUN_ENV = {
  ARENA_ROUNDS: "1",
  ARENA_SPIKE: "4000",
  ARENA_CHURN: "2000",
  ARENA_HELD: "20",
} as const;

async function buildOnce(tag: string): Promise<string> {
  const prev = process.env["SCRIPTC_PROF_CFLAGS"];
  process.env["SCRIPTC_PROF_CFLAGS"] = `-include ${cycstat} -DSCR_CYCSTAT_ON -include ${probe}`;
  try {
    const result = await compile(src, {
      outPath: join(work, exeName(`churn-${tag}`)),
      outDir: join(work, tag),
      sanitize: false,
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    return result.binaryPath;
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
    else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
  }
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function chunksOf(bin: string): Promise<number> {
  const { stderr } = await execFileAsync(bin, [], {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...RUN_ENV },
  });
  const m = /^\[cycstat] arena chunks=(\d+)/m.exec(stderr.replace(/\r\n/g, "\n"));
  /* No line at all is the instrument missing, which must not read as a
   * chunk count of zero. */
  expect(m, `no [cycstat] arena line in:\n${stderr}`).not.toBeNull();
  return Number(m![1]);
}

describe.skipIf(!armable)("the build cache keys on a forced include's bytes", () => {
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  test("an unchanged header hits; an edited one does not", async () => {
    mkdirSync(work, { recursive: true });
    writeFileSync(probe, V1);
    const a = await buildOnce("a");
    const shaA = sha(a);
    const chunksA = await chunksOf(a);
    expect(chunksA).toBeGreaterThan(0);

    /* THE CONTROL. Nothing changed, so the cache must serve the same bytes.
     * Without this, the assertion below is satisfied by a cache that is
     * simply switched off. */
    const b = await buildOnce("b");
    expect(sha(b)).toBe(shaA);

    /* THE CLAIM. Only the header's contents changed — same path, same flag
     * string, same program, same runtime tree. */
    writeFileSync(probe, V2);
    const c = await buildOnce("c");
    expect(sha(c)).not.toBe(shaA);

    /* And the binary that ran was built from the header on disk: a 32 KiB
     * chunk serves half the blocks, so the same workload takes more chunks. */
    const chunksC = await chunksOf(c);
    expect(chunksC).toBeGreaterThan(chunksA);
  }, 900_000);
});
