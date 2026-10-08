/* Turn a knob-on run into NAMES, not a count.
 *
 * The gate reports a per-shard verdict; the question here is which FILES
 * fail with the knob on, because that is the distance between today and the
 * knob becoming the default. Each shard writes a vitest JSON report and that
 * carries per-file results, so the names are already on disk and need no
 * re-run to recover.
 *
 * Reads the structured report rather than grepping the human log: a log line
 * is formatted for a reader, and a guessed keyword against it is not a
 * measurement.
 *
 * WHAT THIS REFUSES TO DO IS THE POINT. Three ways a run can be partial all
 * used to print "every collected file passes", which is absence read as
 * clean -- the exact shape that costs a day:
 *
 *   a suite that FAILED TO COLLECT reports status:"failed" with ZERO
 *       assertionResults. Filtering only on assertion status counted it as
 *       a passing file. This is the likeliest knob-on failure of all: the
 *       knob changes the emitted C, so a file that dies during import or
 *       setup produces exactly this shape and nothing else.
 *   an UNREADABLE shard (truncated mid-write, killed gate) printed a
 *       warning and then a verdict that ignored it.
 *   MISSING shards -- 2 of 6 present -- read as clean, because nothing
 *       compared against how many were expected.
 *
 * AND THE SHAPE ASSUMPTION IS ITSELF UNVERIFIED. If vitest spells a suite
 * status "fail" where this expects "failed", the extractor reports little or
 * nothing and that reads exactly like a clean run. So the JSON is not trusted
 * alone: the same gate writes BOTH --reporter=default and --reporter=json in
 * one pass (gate-sharded.ps1:350), so each shard leaves a human log beside its
 * JSON. This cross-checks the two INDEPENDENT artifacts -- counts parsed from
 * the log's "Test Files" summary against counts derived from the JSON. They
 * disagree only if the shape assumption is wrong, and that shows up in the
 * same run instead of three hours later.
 *
 * A cross-check that cannot run is NOT a cross-check that passed. A missing
 * or unsummarised log makes the result INCOMPLETE, for the same reason a
 * missing shard does.
 *
 * So the verdict is now three-valued and the exit code carries it:
 *   0  complete and clean      1  complete, failures named      2  INCOMPLETE
 * Exit 2 means the output is not evidence of anything. Pass --expect-shards
 * N to make a short run detectable at all.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
const expectArg = argv.find((a) => a.startsWith("--expect-shards="));
const expectShards = expectArg ? Number(expectArg.split("=")[1]) : null;
/* SHARDS ARE ONE AXIS AND FILES ARE THE NEIGHBOURING ONE.
 * Six shards can all be present, all readable, all green, and still have
 * executed 180 of the partition's 214 files -- the lost 34 are then invisible
 * in every count this tool prints. Guarding shards and not files is the same
 * shape as guarding assertions and not suite status: a completeness check
 * that watches one axis and leaves its neighbour open. */
const filesArg = argv.find((a) => a.startsWith("--expect-files="));
const expectFiles = filesArg ? Number(filesArg.split("=")[1]) : null;
if (!dir) {
  console.error("usage: knobon-names.mjs <logDir> [--expect-shards=N] [--expect-files=N]");
  process.exit(2);
}

const SEP = String.fromCharCode(92); // backslash, spelled so no layer can eat it
const failed = new Map();
const unreadable = [];
const seenShards = [];
const xcheck = [];   // one entry per shard: ok | mismatch | unavailable
/* A FILE THAT RAN NO TESTS AT ALL.
 * It reports, so it satisfies --expect-files. It has no failing assertion, so
 * it is not named. Its suite status is not "failed", so the collection-failure
 * arm misses it. It contributes 0 to every count, so it provokes no
 * disagreement with the summary. It passes through the whole instrument as
 * clean, and the knob-on run is exactly where it is plausible: if the knob
 * breaks collection, the failure mode is an ABSENT test, not a red one, and
 * the exit code is 0. Absent is not passing. */
const emptyFiles = [];

/* SECOND, INDEPENDENT INSTRUMENT.
 * Different artifact (the human log, not the JSON) and a different parser.
 * Built with no backslash escapes at all -- character codes instead -- because
 * escapes crossing a second parse layer have degraded silently four times
 * today, and a cross-check that is quietly wrong is worse than none. */
const ESC = String.fromCharCode(27);
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const ANSI = new RegExp(ESC + "[[][0-9;?]*[ -/]*[@-~]", "g");
const WS = "[ " + TAB + "]";
const TESTFILES = new RegExp("^" + WS + "*Test Files" + WS + "{2,}(.+)$");
/* The gate's own verdict reads BOTH summary lines and so must this. Files and
 * tests are neighbouring axes, and guarding one is how the other gets through. */
const TESTSLINE = new RegExp("^" + WS + "*Tests" + WS + "{2,}(.+)$");

function crossCheck(jsonName, shardFiles, shardFailed, shardTests) {
  const logPath = join(dir, jsonName.replace(/[.]json$/, ".log"));
  let text;
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    xcheck.push({ shard: jsonName, state: "unavailable", why: "no sibling log file" });
    return;
  }
  // LAST summary line wins, as the gate's own parser does.
  let line = null;
  for (const raw of text.split(NL)) {
    const m = raw.replace(ANSI, "").match(TESTFILES);
    if (m) line = m[1].trim();
  }
  if (line === null) {
    xcheck.push({ shard: jsonName, state: "unavailable", why: "log has no 'Test Files' summary (truncated or killed)" });
    return;
  }
  let testsLine = null;
  for (const raw of text.split(NL)) {
    const m = raw.replace(ANSI, "").match(TESTSLINE);
    if (m) testsLine = m[1].trim();
  }
  let logFailed = 0;
  for (const m of line.matchAll(new RegExp("([0-9]+)" + WS + "+failed", "g"))) logFailed += Number(m[1]);
  const totalM = line.match(new RegExp("[(]([0-9]+)[)]"));
  const logTotal = totalM ? Number(totalM[1]) : null;

  const bad = [];
  if (logFailed !== shardFailed) bad.push("failed files: log says " + logFailed + ", JSON says " + shardFailed);
  if (logTotal !== null && logTotal !== shardFiles) bad.push("total files: log says " + logTotal + ", JSON says " + shardFiles);
  if (testsLine !== null) {
    const tm = testsLine.match(new RegExp("[(]([0-9]+)[)]"));
    const logTests = tm ? Number(tm[1]) : null;
    if (logTests !== null && logTests !== shardTests) {
      bad.push("test count: log says " + logTests + ", JSON says " + shardTests);
    }
  }
  if (bad.length > 0) xcheck.push({ shard: jsonName, state: "mismatch", why: bad.join("; ") + "  [summary: " + line + "]" });
  else xcheck.push({ shard: jsonName, state: "ok", why: line });
}
let files = 0;
let tests = 0;
let passedFiles = 0;

for (const f of readdirSync(dir).filter((n) => /^shard-\d+[.]json$/.test(n)).sort()) {
  let rep;
  try {
    rep = JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch (e) {
    console.log("REPORT-UNREADABLE " + f + ": " + e.message);
    unreadable.push(f);
    continue;
  }
  seenShards.push(f);
  let shardFiles = 0;
  let shardFailed = 0;
  let shardTests = 0;
  for (const tr of rep.testResults ?? []) {
    files++;
    shardFiles++;
    const name = String(tr.name ?? "?")
      .split(SEP)
      .join("/")
      .replace(/^.*\/(tests|packages)\//, "$1/");
    const results = tr.assertionResults ?? [];
    tests += results.length;
    shardTests += results.length;
    const bad = results.filter((a) => a.status === "failed");

    /* A suite can fail WITHOUT any failing assertion: it never got far
     * enough to have one. Trust the suite's own status, not just its
     * children, or an import error reads as a pass. */
    const suiteFailed = tr.status === "failed" || tr.status === "fail";
    if (bad.length === 0 && suiteFailed) {
      const why = String(tr.message ?? "").split(String.fromCharCode(10))[0].trim();
      failed.set(name, [
        "<no test ran: suite status=" + tr.status + ", collection or setup failure>" +
          (why ? "  " + why.slice(0, 160) : ""),
      ]);
      shardFailed++;
    } else if (bad.length > 0) {
      failed.set(name, bad.map((a) => a.fullName ?? a.title));
      shardFailed++;
    } else if (results.length === 0) {
      emptyFiles.push(name);
    } else {
      passedFiles++;
    }
  }
  crossCheck(f, shardFiles, shardFailed, shardTests);
}

/* A corrupt shard is PRESENT but unusable -- count it as unreadable,
 * not also as missing, or one broken file reports as two problems. */
const missing = expectShards === null ? 0 : Math.max(0, expectShards - seenShards.length - unreadable.length);
const xMismatch = xcheck.filter((x) => x.state === "mismatch");
const xUnavail = xcheck.filter((x) => x.state === "unavailable");
const xOk = xcheck.filter((x) => x.state === "ok");
const fileGap = expectFiles === null ? 0 : expectFiles - files;
const incomplete =
  seenShards.length === 0 || unreadable.length > 0 || missing > 0 ||
  xMismatch.length > 0 || xUnavail.length > 0 || fileGap !== 0 || emptyFiles.length > 0;

console.log(
  "KNOBON-FILES shards=" + seenShards.length +
  (expectShards === null ? "" : "/" + expectShards) +
  " unreadable=" + unreadable.length +
  " files=" + files + (expectFiles === null ? "" : "/" + expectFiles) +
  " empty=" + emptyFiles.length + " passed=" + passedFiles + " failed=" + failed.size + " tests=" + tests +
  " xcheck=" + xOk.length + "ok/" + xMismatch.length + "mismatch/" + xUnavail.length + "unavailable",
);
console.log("");

if (failed.size > 0) {
  console.log("KNOBON-RESULT " + failed.size + " file(s) fail with the knob on, named:");
  for (const [file, names] of [...failed].sort()) {
    console.log("  " + file + "  (" + names.length + " test" + (names.length === 1 ? "" : "s") + ")");
    for (const n of names.slice(0, 4)) console.log("      - " + n);
    if (names.length > 4) console.log("      ... and " + (names.length - 4) + " more");
  }
  console.log("");
}

if (incomplete) {
  const why = [];
  if (seenShards.length === 0) why.push("no readable shard JSON report was found");
  if (unreadable.length > 0) why.push(unreadable.length + " shard report(s) unreadable: " + unreadable.join(", "));
  if (missing > 0) why.push(missing + " shard report(s) missing of " + expectShards + " expected");
  for (const x of xMismatch) {
    why.push("CROSS-CHECK MISMATCH on " + x.shard + " -- " + x.why);
    why.push("    The two instruments disagree, so the JSON shape assumption is WRONG and");
    why.push("    the named list above is not trustworthy. Fix the reader, re-read; no re-run needed.");
  }
  for (const x of xUnavail) why.push("cross-check could not run on " + x.shard + ": " + x.why);
  if (emptyFiles.length > 0) {
    why.push(emptyFiles.length + " file(s) reported ZERO tests -- they ran nothing:");
    for (const n of emptyFiles.slice(0, 8)) why.push("      - " + n);
    if (emptyFiles.length > 8) why.push("      ... and " + (emptyFiles.length - 8) + " more");
    why.push("    These satisfy --expect-files and produce no failure, which is exactly how");
    why.push("    they pass as clean. A file that ran nothing has not passed.");
  }
  if (fileGap > 0) {
    why.push(fileGap + " test file(s) never reported: partition expected " + expectFiles + ", reports account for " + files);
    why.push("    Shards can all be present and green while files go missing; those " + fileGap + " are");
    why.push("    unrun, not passing. A clean verdict over fewer files is not a clean suite.");
  }
  if (fileGap < 0) {
    why.push((-fileGap) + " MORE file(s) reported than the partition expected (" + expectFiles + " expected, " + files + " seen)");
    why.push("    The partition and the run disagree -- one of the two is stale.");
  }
  console.log("KNOBON-RESULT INCOMPLETE -- this is NOT evidence that the rest passes:");
  for (const w of why) console.log("  - " + w);
  if (seenShards.length === 0 || unreadable.length > 0 || missing > 0) {
    console.log("  Whatever those shards held is unmeasured, not clean.");
  }
  /* The symmetric error. This verdict is about the REPORTS IN THIS DIRECTORY
   * and nothing else. A run killed mid-flight writes no JSON, yet its failures
   * may have been read live from its output and reproduced since. Reading
   * "nothing was measured here" as "nothing ever failed" is the same mistake
   * as reading a missing shard as a clean one, pointed the other way. */
  console.log("");
  console.log("  Note: an absent report is not an absent finding. This says only that THESE");
  console.log("  reports cannot be read -- not that the run produced nothing. A run killed");
  console.log("  mid-flight can still have yielded observations read live and reproduced");
  console.log("  independently since. Check for a PROVENANCE note beside the logs.");
  process.exit(2);
}
if (failed.size === 0) {
  console.log("KNOBON-RESULT every collected file passes with the knob on");
  console.log("  (cross-checked against each shard's own 'Test Files' summary: " + xOk.length + " shard(s) agree)");
  if (expectFiles !== null) console.log("  (all " + expectFiles + " partitioned file(s) accounted for)");
}
process.exit(failed.size > 0 ? 1 : 0);
