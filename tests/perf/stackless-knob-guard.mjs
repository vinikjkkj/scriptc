#!/usr/bin/env node
/**
 * stackless-knob-guard.mjs -- prove, BY ARTIFACT, that the compiler a
 * measurement is about to invoke actually reads SCRIPTC_STACKLESS.
 *
 * THE DEFECT THIS EXISTS FOR. The packages' dist/ trees are gitignored and
 * nothing the gate runs rebuilds them (vitest aliases @scriptc/compiler to
 * src/, so the suite is structurally blind to a stale dist). A dist built
 * before the stackless lane landed does not contain the single read site
 * (ir/coro-plans.ts: process.env["SCRIPTC_STACKLESS"] === "0"). A
 * differential then sets SCRIPTC_STACKLESS=0 for its reference arm, gets
 * the fibre lane anyway, and its treatment arm is ALSO the fibre lane: it
 * compares a lane with itself and REPORTS AGREEMENT. A knob that reads OFF
 * gives a wrong number; a knob that is not read at all gives a comparison
 * that passes, and that does not look like a defect.
 *
 * WHY BY ARTIFACT AND NOT BY GREP. Grepping dist/ for the string is the
 * weak form: it passes on a dist where the string survives only in a
 * comment, and it cannot see a resolution chain that loads some other
 * file. This guard compiles a real async program twice through the REAL
 * CLI entry and compares the emitted LLVM IR. About 1.5s per arm.
 *
 * IT CANNOT PASS BY DOING NOTHING. Every check increments a counter; the
 * run fails unless the number of checks that actually EXECUTED equals the
 * number declared. "Did not apply" is never "not scored" -- it is an error.
 *
 * USAGE
 *   node tests/perf/stackless-knob-guard.mjs [--cli <path to main.js>]
 * or set SCRIPTC_GUARD_CLI. Default: packages/cli/dist/main.js in this
 * repo. Point it at whatever entry YOUR harness invokes -- a worktree's
 * dist, or another checkout. Exit 0 = the knob is live. Exit 1 = do not
 * measure.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const DECLARED_CHECKS = 6;
let ran = 0;
const lines = [];
let failed = false;

function check(name, ok, detail) {
  ran += 1;
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failed = true;
  lines.push("  [" + tag + "] " + name + (detail ? " -- " + detail : ""));
}

function die(why) {
  console.error("");
  console.error("STACKLESS KNOB GUARD: CANNOT CERTIFY");
  console.error("  " + why);
  console.error("");
  console.error("  This is a FAILURE, not a skip. Do not run a measurement that");
  console.error("  depends on SCRIPTC_STACKLESS until this is resolved.");
  process.exit(1);
}

// ---- which CLI entry are we certifying? ------------------------------------
const argv = process.argv.slice(2);
const cliFlag = argv.indexOf("--cli");
let cli =
  cliFlag >= 0 && argv[cliFlag + 1] !== undefined
    ? argv[cliFlag + 1]
    : process.env["SCRIPTC_GUARD_CLI"] ?? join(REPO, "packages", "cli", "dist", "main.js");
cli = resolve(cli);

if (!existsSync(cli)) die("CLI entry does not exist: " + cli);

// ---- the probe -------------------------------------------------------------
const PROBE = [
  "async function step(n: number): Promise<number> {",
  "  return n + 1;",
  "}",
  "async function run(): Promise<number> {",
  "  let total = 0;",
  "  total += await step(total);",
  "  total += await step(total);",
  "  return total;",
  "}",
  "run().then((v) => console.log(v));",
  "",
].join("\n");

const work = mkdtempSync(join(process.env["TMP"] || tmpdir(), "stackless-guard-"));
const src = join(work, "probe.ts");
writeFileSync(src, PROBE);

function arm(tag, knob) {
  const out = join(work, tag);
  const env = { ...process.env };
  // A cache hit can serve one arm's artifact to the other and manufacture
  // the very agreement we are testing for. Both caches off, both arms.
  env["SCRIPTC_NO_CACHE"] = "1";
  delete env["SCRIPTC_CACHE_DIR"];
  if (knob === null) delete env["SCRIPTC_STACKLESS"];
  else env["SCRIPTC_STACKLESS"] = knob;

  const r = spawnSync(
    process.execPath,
    [cli, "build", src, "--backend", "llvm", "--keep-c", "-o", join(out, "probe.exe")],
    { env, encoding: "utf8", cwd: work },
  );
  const log = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) {
    die(
      "arm '" + tag + "' failed to build (exit " + r.status + ").\n" +
        "  cli=" + cli + "\n" +
        "  --- build output ---\n" + log,
    );
  }
  if (log.includes("early cache hit")) {
    die("arm '" + tag + "' took an EARLY CACHE HIT; the artifact is not this arm's.\n  " + log.trim());
  }
  const found = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith(".ll")) : [];
  if (found.length !== 1) {
    die(
      "arm '" + tag + "' did not leave exactly one .ll (found " + found.length + ") in " + out +
        ".\n  Without the emitted TU there is nothing to compare, so this is a FAILURE.",
    );
  }
  const text = readFileSync(join(out, found[0]), "utf8");
  return {
    tag,
    bytes: Buffer.byteLength(text),
    sha: createHash("sha256").update(text).digest("hex").slice(0, 16),
    fiber: (text.match(/scr_fiber/g) || []).length,
  };
}

const absent = arm("knob-absent", null);
const off = arm("knob-zero", "0");

// ---- the checks ------------------------------------------------------------
check(
  "the two arms produced DIFFERENT artifacts",
  absent.sha !== off.sha,
  "absent sha=" + absent.sha + "  zero sha=" + off.sha,
);
check(
  "knob ABSENT emits the STACKLESS lane (zero scr_fiber refs)",
  absent.fiber === 0,
  "scr_fiber refs=" + absent.fiber,
);
check(
  "knob=0 emits the FIBRE lane (one or more scr_fiber refs)",
  off.fiber > 0,
  "scr_fiber refs=" + off.fiber,
);
check(
  "the opt-out moves the artifact in the DOCUMENTED direction",
  off.fiber > absent.fiber,
  "fibre refs off=" + off.fiber + " > absent=" + absent.fiber,
);
check("knob-absent arm emitted a non-empty TU", absent.bytes > 0, absent.bytes + " bytes");
check("knob-zero arm emitted a non-empty TU", off.bytes > 0, off.bytes + " bytes");

// ---- report ----------------------------------------------------------------
console.log("");
console.log("STACKLESS KNOB GUARD");
console.log("  cli entry : " + cli);
console.log("  probe     : 10-line two-suspension async program");
console.log("");
console.log("  arm           ll bytes   scr_fiber   sha256-16");
for (const a of [absent, off]) {
  console.log(
    "  " + a.tag.padEnd(13) + String(a.bytes).padStart(8) + String(a.fiber).padStart(12) +
      "   " + a.sha,
  );
}
console.log("");
for (const l of lines) console.log(l);
console.log("");

rmSync(work, { recursive: true, force: true });

if (ran !== DECLARED_CHECKS) {
  console.error(
    "GUARD IS BROKEN: declared " + DECLARED_CHECKS + " checks but only " + ran + " executed.",
  );
  console.error("A guard that can silently skip a check cannot certify anything.");
  process.exit(1);
}

if (failed) {
  console.error("STACKLESS KNOB GUARD: FAILED (" + ran + " checks ran)");
  console.error("");
  console.error("  The compiler at the entry above does NOT honour SCRIPTC_STACKLESS.");
  console.error("  A differential run against it compares a lane WITH ITSELF and");
  console.error("  reports agreement. DO NOT MEASURE.");
  console.error("");
  console.error("  Most likely cause: a stale dist (gitignored, no gate rebuilds it,");
  console.error("  and vitest aliases the compiler to src/). Rebuild with tsc PER");
  console.error("  PACKAGE and a REDIRECTED --tsBuildInfoFile:");
  console.error("    node packages/compiler/node_modules/typescript5/bin/tsc \\");
  console.error("      -p packages/compiler/tsconfig.json --tsBuildInfoFile <fresh path>");
  console.error("  rc=0 is not proof of emission -- count the emitted files.");
  process.exit(1);
}

console.log("STACKLESS KNOB GUARD: OK (" + ran + "/" + DECLARED_CHECKS + " checks ran)");
