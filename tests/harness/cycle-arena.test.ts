/* THE CYCLE ARENA GIVES ITS CHUNKS BACK, AND THIS IS WHAT SAYS SO.
 *
 * scr_cycle.c carves cycle-headered objects out of 64 KiB chunks. Until
 * this revision it could never free one: a block carried no way back to the
 * chunk it came from, so the arena could not learn that a chunk had emptied,
 * and a workload whose small-object population SPIKED kept the high-water
 * for the life of the process (measured on a zapo history sync: 1,053
 * chunks taken, zero freed, 72% of the settled heap at 4% occupancy). A
 * chunk now carries a header, a live count, and a free list of its own, and
 * is handed back to the allocator when the count reaches zero.
 *
 * THE THING THAT MUST NOT BE TAKEN ON TRUST is the map from a block to its
 * chunk, because getting it wrong frees a chunk with live blocks in it and
 * that is a use-after-free which surfaces as random corruption a long way
 * from scr_cycle.c. So this file does not only ask "did the program still
 * print the right thing":
 *
 *   THE ARMED BUILD carries -DSCR_CYC_ARENA_VERIFY=1, which checks on EVERY
 *   free of a carved block that the computed chunk really contains the
 *   block, on the stride grid, in the right size class, with a block out to
 *   account for. A clean run of the armed binary is the map's proof, not an
 *   assertion about it.
 *
 *   THE SAME BUILD carries cycstat, so the reclamation is a NUMBER and not
 *   an inference: chunks taken, chunks freed, chunks still held.
 *
 * THE NEGATIVE CONTROL IS SCR_CYCLE_ARENA=0, which is an ENV knob and not a
 * build flag, so both arms are the SAME BINARY and the comparison carries no
 * code-layout confound. On that arm the arena must carve NOTHING — and
 * cycstat prints its own "ARENA NEVER CARVED" line, so "the arena did not
 * run" and "the hooks were never compiled" cannot read alike.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT ASSERT is megabytes. RSS on this host
 * swings far wider than any effect a gate-sized fixture can produce (see
 * heap-trim.test.ts's note: 6.0-80.2 MiB across six runs of one arm). The
 * settled-RSS measurement belongs to tests/perf/zapo-rest and its rig. What
 * is deterministic is the COUNT, and the count is what is here.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const rcAudit = process.env["SCRIPTC_RC_AUDIT"] === "1";
const src = join(repoRoot, "tests/fixtures/cycle-arena/churn.ts");

/* The instrument headers are named to the compiler through
 * SCRIPTC_PROF_CFLAGS, which cc.ts splits on WHITESPACE. A repo checked out
 * under a path containing a space cannot be quoted through that, so this
 * file says it cannot look rather than reporting a green it did not earn. */
const cycstat = join(repoRoot, "tests/perf/cycstat/scr_cyc_stat.h").replace(/\\/g, "/");
const pagecen = join(repoRoot, "tests/perf/pagecensus/scr_page_census.h").replace(/\\/g, "/");
const pathIsQuotable = !/\s/.test(cycstat) && !/\s/.test(pagecen);

/* The arena is compiled out under SCR_RC_AUDIT (that lane exists to prove
 * every logical free is a real free, so it must reach free() for every
 * block), and the sanitized lane does not link on this toolchain. Either
 * way there is nothing here to measure, and skipping loudly beats asserting
 * a zero that means "not armed". */
const armable = pathIsQuotable && !rcAudit;

interface Arena {
  readonly chunks: number;
  readonly freed: number;
  readonly held: number;
  readonly peakheld: number;
  readonly carved: number;
  readonly listhit: number;
  readonly listgive: number;
  readonly callocfallback: number;
}

function parseArena(stderr: string): Arena | null {
  const m =
    /^\[cycstat] arena chunks=(\d+) freed=(\d+) held=(\d+) peakheld=(\d+) carved=(\d+) listhit=(\d+) listgive=(\d+) callocfallback=(\d+)/m.exec(
      stderr.replace(/\r\n/g, "\n")
    );
  if (m === null) return null;
  return {
    chunks: Number(m[1]),
    freed: Number(m[2]),
    held: Number(m[3]),
    peakheld: Number(m[4]),
    carved: Number(m[5]),
    listhit: Number(m[6]),
    listgive: Number(m[7]),
    callocfallback: Number(m[8]),
  };
}

async function run(
  bin: string,
  extra: Readonly<Record<string, string>> = {}
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(bin, [], {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      ARENA_ROUNDS: "3",
      ARENA_SPIKE: "20000",
      ARENA_CHURN: "40000",
      ARENA_HELD: "300",
      ...extra,
    },
  });
  return { stdout: stdout.replace(/\r\n/g, "\n"), stderr: stderr.replace(/\r\n/g, "\n") };
}

/* 3 rounds x 20 000 nodes summed every 1000th (0+1000+...+19 000 = 190 000
 * per round) = 570 000, then 40 000 rounds of (0 + held[i % 300].v): 133
 * whole cycles of 0..299 (133 x 44 850 = 5 965 050) plus a tail of 0..99
 * (4 950) = 5 970 000. The figure is arithmetic on purpose — a fixture whose
 * expected output is whatever it printed last cannot fail. */
const EXPECTED = "arena 6540000 300\n";

describe.skipIf(!armable)("the cycle arena returns its chunks", () => {
  const key = createHash("sha256")
    .update(readFileSync(src))
    .update(readFileSync(join(repoRoot, "packages/runtime/src/scr_cycle.c")))
    .update(readFileSync(pagecen))
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `cycle-arena-${key}`);
  let bin = "";

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    /* SCRIPTC_PROF_CFLAGS is read out of the environment by cc.ts and lands
     * in the build-cache key (flags AND the header's bytes), so this armed
     * binary never shares a cache entry with an ordinary one. */
    const prev = process.env["SCRIPTC_PROF_CFLAGS"];
    process.env["SCRIPTC_PROF_CFLAGS"] =
      `-include ${cycstat} -DSCR_CYCSTAT_ON -DSCR_CYC_ARENA_VERIFY=1` +
      ` -include ${pagecen} -DSCR_PAGECEN_ON`;
    try {
      const result = await compile(src, {
        outPath: join(dir, exeName("churn")),
        outDir: dir,
        sanitize,
      });
      if (!result.ok) {
        throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      }
      bin = result.binaryPath;
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
      else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
    }
  }, 600_000);

  test("the default arm carves, reclaims, and holds almost nothing", async () => {
    const { stdout, stderr } = await run(bin);
    expect(stdout).toBe(EXPECTED);
    const a = parseArena(stderr);
    /* An unparseable line is the instrument failing, not the arena: say so
     * with the line rather than with a bare `null`. */
    expect(a, `no [cycstat] arena line in:\n${stderr}`).not.toBeNull();
    const arena = a!;
    /* Armed at all. */
    expect(arena.carved).toBeGreaterThan(0);
    expect(arena.chunks).toBeGreaterThan(0);
    /* THE CLAIM. Chunks came back, and what is still held at exit is a
     * small residue — one cached chunk per live size class, which this
     * fixture has a handful of, never the high-water. */
    expect(arena.freed).toBeGreaterThan(0);
    expect(arena.held).toBe(arena.chunks - arena.freed);
    expect(arena.held).toBeLessThanOrEqual(33);
    expect(arena.held).toBeLessThan(arena.peakheld);
    /* The reuse the old global free list never got: with the pool routed
     * away from carved blocks, a freed block is handed back out. */
    expect(arena.listhit).toBeGreaterThan(0);
    expect(arena.listgive).toBeGreaterThan(0);
    /* Every block the arena serves is a block that did not reach calloc. */
    expect(arena.callocfallback).toBe(0);
  }, 600_000);

  test("SCR_CYCLE_ARENA=0 carves nothing and prints the same program output", async () => {
    const { stdout, stderr } = await run(bin, { SCR_CYCLE_ARENA: "0" });
    expect(stdout).toBe(EXPECTED);
    const a = parseArena(stderr);
    expect(a, `no [cycstat] arena line in:\n${stderr}`).not.toBeNull();
    expect(a!.carved).toBe(0);
    expect(a!.chunks).toBe(0);
    expect(a!.freed).toBe(0);
    /* cycstat's own refusal line, which is what keeps this zero readable. */
    expect(stderr).toContain("ARENA NEVER CARVED");
  }, 600_000);

  test("the budget arm still bounds the arena, and still agrees", async () => {
    /* One chunk's worth of ceiling: past it every miss falls back to calloc,
     * which is the pre-reclamation workaround still doing its job. Both arms
     * are the same binary, so this is the knob and nothing else. */
    const { stdout, stderr } = await run(bin, { SCR_CYCLE_ARENA_BUDGET: "65536" });
    expect(stdout).toBe(EXPECTED);
    const a = parseArena(stderr);
    expect(a, `no [cycstat] arena line in:\n${stderr}`).not.toBeNull();
    expect(a!.callocfallback).toBeGreaterThan(0);
    expect(a!.peakheld).toBeLessThanOrEqual(1);
  }, 600_000);

  /* ── the page census ───────────────────────────────────────────────────
   * tests/perf/pagecensus measures the WHOLE FREE PAGES inside the chunks
   * the arena still holds — the ceiling on any per-page reclaimer. It is an
   * instrument, so what is asserted here is that it can be wrong: its
   * synthetic arm has a known answer including a case whose answer is ZERO,
   * its walk reconciles with the arena's own `used`, and its chunk count
   * reconciles with cycstat's `held` on the SAME run. The megabytes belong
   * to tests/perf/zapo-rest, for the reason at the top of this file. */
  interface Pages {
    readonly chunks: number;
    readonly full: number;
    readonly nolive: number;
    readonly free: number;
  }

  function parsePages(stderr: string): Pages | null {
    const s = stderr.replace(/\r\n/g, "\n");
    const c = /^\[pagecen] chunks=(\d+) cur=(\d+) part=(\d+) full=(\d+) nolive=(\d+)/m.exec(s);
    const f = /^\[pagecen] CEILING aligned freepages=(\d+)/m.exec(s);
    if (c === null || f === null) return null;
    return {
      chunks: Number(c[1]),
      full: Number(c[4]),
      nolive: Number(c[5]),
      free: Number(f[1]),
    };
  }

  test("the census validates its own arithmetic before it reports any", async () => {
    const { stderr } = await run(bin);
    /* The synthetic arm. Two of the five cases carry the weight. `alllive`
     * is a chunk with every slot live and must report ZERO free pages: an
     * instrument that can only say "yes" cannot adjudicate a ceiling. And
     * `clustered15` against `scattered15` is the SAME fifteen survivors of
     * the same size placed two ways -- packed into one page, and one per
     * page -- which must answer 14 and 0. A census that returns the same
     * number for those two is measuring occupancy, not placement, and
     * placement is the whole question. */
    expect(stderr).toContain(
      "[pagecen] SYNTH ok allfree want=15 got=15 onelive want=14 got=14" +
        " alllive want=0 got=0 clustered15 want=14 got=14 scattered15 want=0 got=0"
    );
    expect(stderr).toMatch(/^\[pagecen] SELFTEST ok on (\d+)\/\1 chunks/m);
    expect(stderr).toContain("[pagecen] NOLIVE CHECK ok");
    expect(stderr).not.toContain("SELFTEST FAILED");
    expect(stderr).not.toContain("NOLIVE CHECK FAILED");
    expect(stderr).not.toContain("SYNTH NOT RUN");

    const p = parsePages(stderr);
    expect(p, `no [pagecen] chunk line in:\n${stderr}`).not.toBeNull();
    const a = parseArena(stderr);
    expect(a).not.toBeNull();
    /* Two independent counters of the same thing: the census walked its own
     * list of every chunk, cycstat subtracted two totals. */
    expect(p!.chunks).toBe(a!.held);
    expect(p!.free).toBeGreaterThan(0);
  }, 600_000);

  test("SCR_CYCLE_ARENA=0 makes the census refuse rather than print zeroes", async () => {
    const { stderr } = await run(bin, { SCR_CYCLE_ARENA: "0" });
    expect(stderr).toContain("[pagecen] NO CHUNKS");
    /* The synthetic arm still runs on this arm, which is what proves the
     * refusal above is about the arena and not about the hooks. */
    expect(stderr).toContain("[pagecen] SYNTH ok");
    expect(stderr).not.toMatch(/^\[pagecen] CEILING/m);
  }, 600_000);

  test("survivors cost free pages, and a full chunk contributes none", async () => {
    /* Same binary, one knob: many more survivors spread over many more
     * chunks. The census must see chunks that are FULL — reachable from
     * neither the current slot nor the partial list — and they must
     * contribute nothing, which is the invariant the walk's all-chunk list
     * exists to be able to check rather than assume. */
    const { stderr } = await run(bin, { ARENA_HELD: "3000", ARENA_CHURN: "40000" });
    const p = parsePages(stderr);
    expect(p, `no [pagecen] chunk line in:\n${stderr}`).not.toBeNull();
    expect(p!.full).toBeGreaterThan(0);
    expect(stderr).toContain("[pagecen] freepages by role");
    expect(stderr).toMatch(/^\[pagecen] freepages by role cur=\d+ part=\d+ full=0$/m);
    expect(stderr).not.toContain("[pagecen] NOTE a FULL chunk reported free pages");
    /* More chunks held, and a strictly lower share of them free, than the
     * default arm above: the census responds to occupancy. */
    const base = parsePages((await run(bin)).stderr)!;
    expect(p!.chunks).toBeGreaterThan(base.chunks);
    expect(p!.free / p!.chunks).toBeLessThan(base.free / base.chunks);
  }, 600_000);
});
