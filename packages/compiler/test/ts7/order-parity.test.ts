/* The MODULE-ORDER (and preflight-verdict) canary: every entry runs the
 * REAL lifecycle through the native (tsgo) frontend and must produce
 * exactly the RECORDED baseline's preflight diagnostics (code, message
 * text, span — the full structured diagnostic) and module evaluation
 * order (baselines/order-parity.json).
 *
 * The baselines were recorded from the typescript@5.9.3 program.ts lane at
 * the phase-4 flip commit — the last commit where both frontends shipped —
 * after the phase-2/3 parity sweeps held the two lanes byte-identical over
 * this same entry set. So "matches the baseline" IS "matches 5.9.3",
 * without keeping the deleted 5.9.3 pipeline alive to ask.
 *
 * ── tsgo UPGRADE PLAYBOOK ────────────────────────────────────────────────
 * This suite (order-parity here; parity.test.ts / resolver-parity.test.ts /
 * facade.test.ts against the live typescript5 island) is the canary lane
 * for bumping the "typescript" (tsgo) dependency:
 *  1. Bump the pin in packages/compiler/package.json, pnpm install,
 *     pnpm build (world-check.ts must still refuse cross-world objects).
 *  2. Run this directory's suites with the full sweep:
 *     SCRIPTC_TS7_ALL=1 pnpm exec vitest run packages/compiler/test/ts7.
 *  3. Every failure is a BEHAVIOR MOVE in the new tsgo. Triage each one:
 *     an intended upstream change (diagnostic wording, constituent order)
 *     gets reviewed and re-recorded; anything else is a regression to
 *     report upstream before shipping the bump.
 *  4. Re-record intentionally. TWO modes, and the difference matters:
 *       SCRIPTC_UPDATE_BASELINES=1        — ADDITIVE. Records only entries
 *         that have no baseline yet; every already-recorded entry is copied
 *         through untouched. This is what you want after adding fixtures,
 *         and it cannot launder a live divergence into the baseline.
 *       SCRIPTC_UPDATE_BASELINES=rewrite  — re-records EVERY entry from the
 *         current native lane. This is the tsgo-bump mode, and the only one
 *         that can overwrite a failing entry with today's wrong answer. It
 *         prints the list of entries whose recorded answer CHANGED; put that
 *         delta in the commit message, one bump per commit.
 *     Additive is the default because the destructive mode has already been
 *     a trap once: re-recording while tests/diagnostics/cycle-window-call
 *     was failing would have pinned a lost SC1016 as correct.
 *  5. Then the real gates: pnpm build + lint, both vitest lanes uncached,
 *     and the diagnostics snapshots (tests/harness/__snapshots__) — those
 *     re-pin the same way, one snapshot per commit with the delta named.
 *
 * Frontend-only (no lowering, no clang), so an entry costs one tsgo
 * program. The default lane runs a deterministic subset weighted toward
 * the risky shapes (every JS/CJS/MJS entry, every multi-file directory
 * case, every diagnostics fixture, the npm and strictness fixtures);
 * SCRIPTC_TS7_ALL=1 widens to the ENTIRE recorded set — the acceptance
 * sweep and the upgrade playbook's step 2.
 *
 * ── WHAT THIS FILE'S FAILURE COUNT MEANS ─────────────────────────────────
 * Two failure classes live here and they are NOT interchangeable:
 *
 *   DIVERGENCE — a recorded entry whose native answer no longer matches.
 *     A real behavior regression. These fail the chunk tests, and a chunk
 *     names EVERY divergent entry it found, not just the first.
 *   UNRECORDED — a corpus entry with no baseline at all. Nothing regressed;
 *     someone shipped a fixture without recording it. These do NOT fail the
 *     chunks. They fail exactly one test, "baseline accounting", which
 *     names all of them at once, over the WHOLE corpus (not just the
 *     sampled subset), because listing them costs a glob and no tsgo.
 *
 * This split is load-bearing history. The chunks used to abort at their
 * first bad entry, so "N failures" was N chunks-that-tripped, and the two
 * classes were indistinguishable without decomposing the log by hand on
 * every merge. At the commit that introduced this comment the old scheme
 * reported "6 failures" for 1 real divergence and 47 unrecorded sampled
 * entries (158 corpus-wide) — and, worse, left 84 of the 461 sampled
 * entries downstream of an abort NEVER COMPARED. */

import { execFileSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { checkPreflightTs7 } from "../../src/frontend/program.js";
import { Ts7Host } from "../../src/frontend/ts7/program.js";
import type { ScrDiagnostic } from "../../src/diagnostics/diagnostic.js";

const repoRoot = join(import.meta.dirname, "../../../..");
const baselinePath = join(import.meta.dirname, "baselines/order-parity.json");
/* "1" is ADDITIVE (records only what has no baseline yet); "rewrite" is the
 * destructive tsgo-bump mode. See the playbook's step 4. */
const UPDATE =
  process.env["SCRIPTC_UPDATE_BASELINES"] === "1" || process.env["SCRIPTC_UPDATE_BASELINES"] === "rewrite";

interface BaselineEntry {
  order: string[];
  diags: ScrDiagnostic[];
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
  entries: Record<string, BaselineEntry>;
};

/** Machine-independent spelling: absolute repo paths become "<repo>/…" in
 * file fields AND message text (cycle messages embed paths).
 *
 * The separator is normalized FIRST because the baseline is recorded in
 * POSIX spelling and win32 hands back backslashes: `join`/`globSync`
 * produce `G:\…\tests\corpus\x.ts`, so splitting on `repoRoot + "/"` never
 * matched and EVERY key missed — the whole suite failing as "no recorded
 * baseline" on Windows, which reads exactly like a stale baseline file and
 * is not one. */
const posix = (s: string): string => s.split("\\").join("/");
const repoRootPosix = posix(repoRoot);
const rel = (s: string): string => posix(s).split(repoRootPosix + "/").join("<repo>/");

/* ── WHOSE FIXTURE IS THIS? ───────────────────────────────────────────────
 * Adding a corpus entry and recording its baseline are two separate acts
 * with nothing tying them at commit time, so a red "baseline accounting"
 * lane used to be AMBIGUOUS: the reader could not tell an unrecorded
 * fixture that arrived on somebody else's merge (chase it to its author)
 * from one they had just written themselves (record it before shipping).
 * Both mistakes have been made here — six fixtures across four blocks
 * shipped unrecorded, four of them found in one day, and at least one
 * agent burned a session chasing a ghost that was its own file.
 *
 * So the offender list NAMES the commit that introduced (or, for a stale
 * key, removed) the path. The distinction that matters most is cheap and
 * exact: a path git has never recorded an add for is in the READER'S OWN
 * working tree, and the answer is "record it in this same commit", not
 * "go ask whoever wrote it".
 *
 * Cost: one `git log` per OFFENDER, and the offender lists are empty on a
 * green lane — so the common path spends nothing. `stdio` closes stdin and
 * discards stderr so a git that wants to prompt or complain cannot hang or
 * pollute the run, and every failure mode degrades to a label. */
function gitAttribution(relKey: string, filter: "A" | "D"): string {
  const path = relKey.startsWith("<repo>/") ? relKey.slice("<repo>/".length) : relKey;
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["log", `--diff-filter=${filter}`, "-1", "--format=%h %ad %s", "--date=short", "--", path],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 },
    ).trim();
  } catch {
    return "unattributed (git unavailable here)";
  }
  if (out === "") {
    return filter === "A"
      ? "UNCOMMITTED — this path has no add commit, so it is in YOUR working tree: record it in the same commit"
      : "UNCOMMITTED — no delete commit, so the removal is in YOUR working tree";
  }
  const line = out.split("\n")[0] ?? "";
  return line.length <= 100 ? line : `${line.slice(0, 97)}...`;
}

/** `<repo>/tests/corpus/x.ts  ← added by <sha> <date> <subject>` */
const attributed = (keys: readonly string[], filter: "A" | "D"): string[] =>
  keys.map((k) => `${k}  ← ${filter === "A" ? "added" : "removed"} by ${gitAttribution(k, filter)}`);

function nativeAnswer(host: Ts7Host, entry: string): BaselineEntry {
  const t7 = checkPreflightTs7(entry, host);
  return {
    order: t7.moduleOrder.map(rel),
    diags: t7.diags.map((d) => ({
      ...d,
      message: rel(d.message),
      loc: { ...d.loc, file: rel(d.loc.file) },
    })),
  };
}

/* Every entry list is spelled POSIX: the shape predicates below ask about
 * "/main." and the baseline is keyed the same way. Node reads forward
 * slashes on win32 happily, so normalizing at the source is enough. */
function entriesUnder(dir: string): string[] {
  const exts = ["ts", "js", "mjs", "cjs"];
  return exts
    .flatMap((ext) => [
      ...globSync(join(repoRoot, dir, `*.${ext}`)),
      ...globSync(join(repoRoot, dir, `*/main.${ext}`)),
    ])
    .map(posix)
    .sort();
}

const FULL = process.env["SCRIPTC_TS7_ALL"] === "1" || UPDATE;

function allEntries(): string[] {
  return [
    ...entriesUnder("tests/corpus"),
    ...entriesUnder("tests/diagnostics"),
    ...entriesUnder("tests/fixtures/npm/cases"),
    ...globSync(join(repoRoot, "tests/fixtures/strictness/*/main.ts")).map(posix).sort(),
    ...globSync(join(repoRoot, "tests/fixtures/node-types/*.ts")).map(posix).sort(),
  ];
}

/* The plain-TS sample: 1-in-32 by a hash OF THE ENTRY'S OWN PATH, never by
 * its POSITION in the sorted list.
 *
 * The positional form this replaces (`filter((_, i) => i % 40 === 0)`) made
 * every entry's membership depend on how many plain-TS fixtures sort before
 * it, so adding ONE fixture re-rolled the sample for the whole tail: three
 * unrelated fixtures would drop out and three others drop in. With an
 * incomplete baseline that turned "I added a fixture" into "three unrelated
 * entries now report no recorded baseline", and an agent chose a `.js`
 * extension over `.ts` purely to dodge it. A gate must not charge you for
 * picking a file extension. Membership is now a property of the file alone;
 * "sample is stable under insertion" is asserted below. */
const sampleHash = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const SAMPLE_1_IN = 32;
const isRisky = (f: string): boolean => !f.endsWith(".ts") || f.endsWith("/main.ts");
const inPlainSample = (f: string): boolean => sampleHash(rel(f)) % SAMPLE_1_IN === 0;

function pickEntries(): string[] {
  const all = allEntries();
  if (FULL) return all;
  // The default subset: everything whose SHAPE is order/preflight-sensitive,
  // plus a deterministic slice of the plain-TS corpus.
  const corpus = entriesUnder("tests/corpus");
  const rest = all.filter((f) => !corpus.includes(f));
  const risky = corpus.filter(isRisky);
  const plain = corpus.filter((f) => !isRisky(f)).filter(inPlainSample);
  return [...risky, ...plain, ...rest];
}

const entries = pickEntries();
const host = new Ts7Host();
afterAll(() => host.close());

/* Entries run in CHUNKS of an async test each, with an event-loop yield
 * between entries: each entry is a fully synchronous blocking tsgo
 * round-trip, and hundreds of back-to-back synchronous tests starve the
 * vitest worker's RPC loop (the full sweep reproducibly died with
 * "[vitest-worker]: Timeout calling onTaskUpdate" — all tests green, exit
 * code 1). The chunking is a SCHEDULING device and nothing else: a chunk
 * compares all of its entries and only then throws, so nothing downstream
 * of a bad entry goes unexamined and the chunk's message names every
 * divergence it found. */
const CHUNK = 20;
const chunks: string[][] = [];
for (let i = 0; i < entries.length; i += CHUNK) chunks.push(entries.slice(i, i + CHUNK));

/* Census, filled by the chunk tests and printed once in afterAll. `compared`
 * counts entries actually held against a baseline — the number the old
 * abort-on-first-failure scheme silently overstated. */
const census = { compared: 0, divergent: [] as string[], unrecorded: [] as string[] };

if (UPDATE) {
  const REWRITE = process.env["SCRIPTC_UPDATE_BASELINES"] === "rewrite";
  test(`${REWRITE ? "re-record EVERY" : "record MISSING"} baseline(s) from the current native frontend`, async () => {
    const record: Record<string, BaselineEntry> = {};
    const added: string[] = [];
    const changed: string[] = [];
    for (const entry of allEntries()) {
      await new Promise((r) => setImmediate(r));
      const key = rel(entry);
      const prev = baseline.entries[key];
      if (prev && !REWRITE) {
        record[key] = prev; // additive: a recorded entry is copied through, never re-asked
        continue;
      }
      const next = nativeAnswer(host, entry);
      record[key] = next;
      if (!prev) added.push(key);
      else if (JSON.stringify(prev) !== JSON.stringify(next)) changed.push(key);
    }
    const dropped = Object.keys(baseline.entries).filter((k) => !(k in record));
    writeFileSync(baselinePath, JSON.stringify({ entries: record }, null, 1) + "\n");
    console.info(
      `order-parity baselines: ${Object.keys(record).length} entries written; ` +
        `${added.length} added; ${changed.length} CHANGED${changed.length ? ` (${changed.join(", ")})` : ""}; ` +
        `${dropped.length} dropped as no longer in the corpus${dropped.length ? ` (${dropped.join(", ")})` : ""}`,
    );
  });
} else {
  describe(`preflight/order canary vs recorded 5.9.3 baselines (${entries.length} entries${FULL ? ", full sweep" : ""})`, () => {
    test.for(chunks.map((c) => [`${c[0]!.slice(repoRootPosix.length + 1)} … +${c.length - 1}`, c] as const))(
      "%s",
      async ([, chunk]) => {
        const bad: string[] = [];
        let first: unknown;
        for (const entry of chunk) {
          await new Promise((r) => setImmediate(r)); // keep the worker RPC alive
          const name = entry.slice(repoRootPosix.length + 1);
          const recorded = baseline.entries[rel(entry)];
          if (recorded === undefined) {
            // NOT a divergence. The "baseline accounting" test below owns
            // this class and names every one of them, corpus-wide.
            census.unrecorded.push(name);
            continue;
          }
          census.compared++;
          const native = nativeAnswer(host, entry);
          try {
            expect(native.order, `${name}: module evaluation order`).toEqual(recorded.order);
            expect(native.diags, `${name}: preflight diagnostics`).toEqual(recorded.diags);
          } catch (e) {
            bad.push(name);
            census.divergent.push(name);
            first ??= e;
          }
        }
        if (first !== undefined) {
          const e = first as Error;
          e.message = `${bad.length} DIVERGENCE(S) in this chunk — ${bad.join(", ")}. First one:\n${e.message}`;
          throw e;
        }
      },
    );
  });

  /* The bookkeeping gate, in the shape of llvm-differential's "tier
   * accounting": it fails the moment the baseline stops covering the corpus,
   * in EITHER direction, and it names the offenders instead of leaving a
   * count to be decomposed. Cheap — globs only, no tsgo — so it runs over
   * the whole corpus even in the sampled default lane, which means an
   * unrecorded fixture is now caught whether or not the sample happened to
   * pick it up. */
  test("baseline accounting: the recorded set is exactly the corpus", () => {
    const corpus = allEntries().map(rel);
    const recordedKeys = new Set(Object.keys(baseline.entries));
    const unrecorded = corpus.filter((k) => !recordedKeys.has(k));
    const corpusSet = new Set(corpus);
    const stale = [...recordedKeys].filter((k) => !corpusSet.has(k));
    expect(
      // Attribution is computed only for offenders, so a green lane spends
      // no git at all. Each line names the commit that added (or removed)
      // the path — or says the path is in the reader's own working tree.
      { unrecorded: attributed(unrecorded, "A"), stale: attributed(stale, "D") },
      `${corpus.length} corpus entries vs ${recordedKeys.size} recorded. ` +
        `unrecorded = shipped without a baseline (add them: SCRIPTC_UPDATE_BASELINES=1, which is ADDITIVE and cannot ` +
        `overwrite a live divergence). stale = recorded but gone from the corpus. Neither is a behavior regression; ` +
        `a chunk failure above is. Each offender is tagged with the commit that introduced it: an "UNCOMMITTED" tag ` +
        `means the file is in THIS working tree and the fix is to record it in the same commit, not to chase a ghost.`,
    ).toEqual({ unrecorded: [], stale: [] });
  });

  /* The instrument's own self-test, armed with a PLANTED offender: a
   * committed path (this very file) must attribute to a real commit, and a
   * path git has never seen must come back UNCOMMITTED. Without this, a
   * `gitAttribution` that silently returned "unattributed" for everything
   * would look exactly like a passing accounting lane. */
  test("the offender attribution names a commit for a tracked path and flags an untracked one", () => {
    const tracked = "<repo>/packages/compiler/test/ts7/order-parity.test.ts";
    const trackedLine = attributed([tracked], "A")[0] ?? "";
    expect(trackedLine.startsWith(`${tracked}  ← added by `)).toBe(true);
    // "<sha> <yyyy-mm-dd> <subject>" — a real commit, not a fallback label.
    expect(trackedLine).toMatch(/← added by [0-9a-f]{7,} \d{4}-\d{2}-\d{2} /);

    const planted = "<repo>/tests/corpus/0000-a-deliberately-unrecorded-fixture.ts";
    expect(attributed([planted], "A")[0]).toContain("UNCOMMITTED");
  });

  afterAll(() => {
    const d = census.divergent;
    console.info(
      `order-parity: ${census.compared}/${entries.length} sampled entries compared against a baseline; ` +
        `${d.length} REAL DIVERGENCE(S)${d.length ? ` (${d.join(", ")})` : ""}; ` +
        `${census.unrecorded.length} sampled entr${census.unrecorded.length === 1 ? "y" : "ies"} had no baseline ` +
        `(not a regression — see the "baseline accounting" test for the corpus-wide list).`,
    );
  });
}

test("a malformed tsconfig fails preflight (JSON.parse wording — the pinned 5.9.3 delta)", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-ts7-badcfg-"));
  writeFileSync(join(dir, "tsconfig.json"), '{ "compilerOptions": { "strict": true, }\n'); // missing brace
  writeFileSync(join(dir, "main.ts"), "console.log(1);\n");
  const entry = join(dir, "main.ts");
  const t7 = checkPreflightTs7(entry, host);
  rmSync(dir, { recursive: true, force: true });
  // Exactly one SC0001 anchored at the tsconfig. The TEXT is JSON.parse's
  // (program.ts's jsoncSyntaxError comment) — 5.9.3 said "'}' expected.";
  // no snapshot pins the wording.
  expect(t7.diags.map((d) => [d.code, d.loc.file])).toEqual([["SC0001", join(dir, "tsconfig.json")]]);
});

/* The property the positional sample did not have. Adding a plain-TS
 * fixture must add AT MOST itself to the sampled subset and must never
 * change whether any OTHER fixture is sampled — otherwise a one-file commit
 * silently swaps which entries the default lane guards, and every baseline
 * gap in the newly-swapped-in set surfaces as somebody else's failure. */
test("the plain-TS sample is stable under corpus insertion", () => {
  const plain = entriesUnder("tests/corpus").filter((f) => !isRisky(f));
  const before = plain.filter(inPlainSample);
  const newcomer = join(repoRoot, "tests/corpus/0000-a-hypothetical-new-fixture.ts").split("\\").join("/");
  const after = [...plain, newcomer].sort().filter(inPlainSample);
  expect(after.filter((f) => f !== newcomer)).toEqual(before);
  expect(plain.length).toBeGreaterThan(100); // the property is vacuous on an empty corpus
});

test("harness sanity: the subset always covers the order-sensitive shapes", () => {
  expect(entries.some((f) => f.endsWith(".cjs"))).toBe(true);
  expect(entries.some((f) => f.endsWith(".mjs"))).toBe(true);
  expect(entries.some((f) => f.endsWith(".js"))).toBe(true);
  expect(entries.some((f) => f.includes("/main."))).toBe(true);
  expect(entries.some((f) => readFileSync(f, "utf8").includes("require("))).toBe(true);
});
