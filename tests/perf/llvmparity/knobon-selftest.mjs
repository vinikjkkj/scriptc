/* ARMING THE EXTRACTOR (Product B), against synthetic input where the answer
 * is known in advance -- never against the run it is supposed to judge.
 *
 * A validation built while looking at the result it should be judging is green
 * by construction. So every expectation below is written from the fixture, and
 * each case asserts BOTH directions: what must appear AND what must not. A
 * check that can only pass is decoration.
 *
 * Proven able to FAIL by mutation: disabling the suite-status arm reddens only
 * the collection-failure case; forcing the cross-check to agree reddens only
 * the two mismatch cases; removing the zero-test guard reddens only that one.
 *
 * Run: node <dir>/knobon-selftest.mjs             (exit 0 = armed)
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/* Resolved from THIS file, never from an absolute scratch path: the pair has
 * to keep working after it moves into the repo, and a self-test that points
 * at where it used to live fails in a way that looks like the tool is gone. */
const TOOL = join(dirname(fileURLToPath(import.meta.url)), "knobon-names.mjs");
const ROOT = join(process.env.TMP ?? tmpdir(), "knobon-selftest");
rmSync(ROOT, { recursive: true, force: true });

const E = String.fromCharCode(27);
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);

const ar = (t, status) => ({
  ancestorTitles: ["g"], fullName: "g > " + t, title: t, status,
  failureMessages: status === "failed" ? ["AssertionError"] : [],
});
const suite = (name, results, status = "passed", message = "") => ({
  assertionResults: results, status, message, name: "G:" + BS + "wt" + BS + name,
});
const rep = (suites) => JSON.stringify({ numTotalTestSuites: suites.length, testResults: suites }, null, 1);

// Decoys: PASSING test names containing failed/FAILED/fails, above the summary.
const decoy = [" OK tests/harness/x.test.ts (1 test)",
               "   OK a name that says FAILED and fails"].join(NL);
// BOTH summary lines, as the gate's own verdict reads both.
const logFor = (tf, tt) =>
  decoy + NL +
  E + "[32m" + " Test Files  " + tf + E + "[39m" + NL +
  " Tests  " + tt + NL + " Duration  3.40s" + NL;

const cases = [];
const C = (name, build, args, rc, must, mustNot = []) =>
  cases.push({ name, build, args, rc, must, mustNot });
const mk = (n) => { const d = join(ROOT, n); mkdirSync(d, { recursive: true }); return d; };

const OK1 = suite("tests/a-ok.test.ts", [ar("p1", "passed")]);

C("zero failures -> says zero, not 'cannot read'", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));
  writeFileSync(join(d, "shard-1.log"), logFor("1 passed (1)", "1 passed (1)"));
}, ["--expect-shards=1"], 0,
  ["every collected file passes"], ["INCOMPLETE", "fail with the knob on"]);

C("ONE known failure -> finds exactly 1, named", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1,
    suite("tests/b-one.test.ts", [ar("the only bad one", "failed")], "failed")]));
  writeFileSync(join(d, "shard-1.log"), logFor("1 failed | 1 passed (2)", "1 failed | 1 passed (2)"));
}, ["--expect-shards=1"], 1,
  ["1 file(s) fail", "tests/b-one.test.ts", "g > the only bad one"], ["INCOMPLETE", "a-ok"]);

C("N=3 files failing (2,1,5 tests) -> exactly 3, all named, 5th truncates", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([
    OK1,
    suite("tests/f1.test.ts", [ar("f1a", "failed"), ar("f1b", "failed")], "failed"),
    suite("tests/f2.test.ts", [ar("f2a", "failed"), ar("ok", "passed")], "failed"),
    suite("tests/f3.test.ts", [1, 2, 3, 4, 5].map((i) => ar("f3-" + i, "failed")), "failed"),
  ]));
  writeFileSync(join(d, "shard-1.log"), logFor("3 failed | 1 passed (4)", "8 failed | 2 passed (10)"));
}, ["--expect-shards=1"], 1,
  ["3 file(s) fail", "tests/f1.test.ts  (2 tests)", "tests/f2.test.ts  (1 test)",
   "tests/f3.test.ts  (5 tests)", "g > f1a", "g > f1b", "g > f2a", "g > f3-4", "and 1 more"],
  ["INCOMPLETE", "g > ok", "g > f3-5"]);

C("collection failure (status failed, ZERO assertions) -> named, not passed", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1,
    suite("tests/imports.test.ts", [], "failed", "Error: Cannot find module './x.js'")]));
  writeFileSync(join(d, "shard-1.log"), logFor("1 failed | 1 passed (2)", "1 passed (1)"));
}, ["--expect-shards=1"], 1,
  ["tests/imports.test.ts", "no test ran", "Cannot find module"],
  ["every collected file passes", "reported ZERO tests"]);

C("all tests skipped -> NOT flagged (no false positive)", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([
    suite("tests/sk.test.ts", [ar("s1", "skipped"), ar("s2", "skipped")])]));
  writeFileSync(join(d, "shard-1.log"), logFor("1 skipped (1)", "2 skipped (2)"));
}, ["--expect-shards=1"], 0,
  ["every collected file passes"], ["fail with the knob on", "INCOMPLETE", "ZERO tests"]);

C("file ran ZERO tests, rc=0, not failed -> refuses, names it", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1,
    suite("tests/empty.test.ts", [])]));   // reports, passes, runs nothing
  writeFileSync(join(d, "shard-1.log"), logFor("2 passed (2)", "1 passed (1)"));
}, ["--expect-shards=1", "--expect-files=2"], 2,
  ["INCOMPLETE", "1 file(s) reported ZERO tests", "tests/empty.test.ts",
   "has not passed"],
  ["every collected file passes"]);

C("log and JSON disagree on TEST count -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));                  // 1 test
  writeFileSync(join(d, "shard-1.log"), logFor("1 passed (1)", "5 passed (5)")); // 5
}, ["--expect-shards=1"], 2,
  ["CROSS-CHECK MISMATCH", "test count: log says 5, JSON says 1", "not trustworthy"],
  ["every collected file passes"]);

C("TRUNCATED log -> refuses, does not report what it read", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));
  writeFileSync(join(d, "shard-1.log"), decoy); // killed before the summary
}, ["--expect-shards=1"], 2,
  ["INCOMPLETE", "no 'Test Files' summary"], ["every collected file passes"]);

C("no log at all -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));
}, ["--expect-shards=1"], 2,
  ["INCOMPLETE", "no sibling log"], ["every collected file passes"]);

C("corrupt JSON -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), "{ truncated mid-w");
  writeFileSync(join(d, "shard-1.log"), logFor("1 passed (1)", "1 passed (1)"));
}, ["--expect-shards=1"], 2,
  ["UNREADABLE", "INCOMPLETE"], ["every collected file passes"]);

C("missing shards (1 of 6) -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));
  writeFileSync(join(d, "shard-1.log"), logFor("1 passed (1)", "1 passed (1)"));
}, ["--expect-shards=6"], 2,
  ["INCOMPLETE", "5 shard report(s) missing"], ["every collected file passes"]);

C("empty dir -> refuses, says nothing was measured", () => {},
  ["--expect-shards=6"], 2,
  ["INCOMPLETE", "no readable shard JSON report"], ["every collected file passes"]);

C("MISMATCH: log sees a failure the JSON missed -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));                           // JSON: 0 failed
  writeFileSync(join(d, "shard-1.log"), logFor("1 failed (1)", "1 passed (1)")); // log:  1 failed
}, ["--expect-shards=1"], 2,
  ["CROSS-CHECK MISMATCH", "log says 1, JSON says 0", "not trustworthy"],
  ["every collected file passes"]);

C("MISMATCH reverse: JSON sees a failure the log did not -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([
    suite("tests/j.test.ts", [ar("bad", "failed")], "failed")]));                // JSON: 1 failed
  writeFileSync(join(d, "shard-1.log"), logFor("1 passed (1)", "1 passed (1)")); // log:  0 failed
}, ["--expect-shards=1"], 2,
  ["CROSS-CHECK MISMATCH", "log says 0, JSON says 1", "not trustworthy"], []);

C("--expect-files short -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1]));
  writeFileSync(join(d, "shard-1.log"), logFor("1 passed (1)", "1 passed (1)"));
}, ["--expect-shards=1", "--expect-files=216"], 2,
  ["INCOMPLETE", "215 test file(s) never reported"], ["every collected file passes"]);

C("--expect-files over (stale partition) -> refuses", (d) => {
  writeFileSync(join(d, "shard-1.json"), rep([OK1,
    suite("tests/c.test.ts", [ar("p", "passed")])]));
  writeFileSync(join(d, "shard-1.log"), logFor("2 passed (2)", "2 passed (2)"));
}, ["--expect-shards=1", "--expect-files=1"], 2,
  ["MORE file(s) reported"], ["every collected file passes"]);

let pass = 0;
let fail = 0;
for (const c of cases) {
  const d = mk(c.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50));
  c.build(d);
  let out = "";
  let rc = 0;
  try {
    out = execFileSync(process.execPath, [TOOL, d, ...c.args], { encoding: "utf8" });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    rc = e.status ?? -1;
  }
  const bad = [];
  if (rc !== c.rc) bad.push("rc=" + rc + " want " + c.rc);
  for (const m of c.must) if (!out.includes(m)) bad.push("MISSING: " + JSON.stringify(m));
  for (const m of c.mustNot) if (out.includes(m)) bad.push("PRESENT BUT FORBIDDEN: " + JSON.stringify(m));
  if (bad.length === 0) {
    pass++;
    console.log("  PASS  " + c.name);
  } else {
    fail++;
    console.log("  FAIL  " + c.name);
    for (const b of bad) console.log("          " + b);
  }
}
console.log("");
console.log("SELFTEST " + (fail === 0 ? "ARMED" : "BROKEN") +
  " pass=" + pass + " fail=" + fail + " of " + cases.length);
process.exit(fail === 0 ? 0 : 1);
