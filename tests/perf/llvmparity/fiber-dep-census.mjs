/* Census of FIBER-DEPENDENT assertion sites, BY PROPERTY.
 *
 * Property: an expectation reachable only when the fiber lowering exists.
 * With SCRIPTC_STACKLESS on, converted functions create no fibers, so
 * anything only the fiber path emits never appears.
 *
 * Keys are read out of the runtime's own source -- the messages the C
 * runtime prints that mention a fiber -- not from a word list, so a new
 * fiber-observable message joins the census without editing this file.
 *
 * TWO DEFECTS THIS FILE ALREADY SURVIVED, both found by testing against
 * sites already KNOWN to be fiber-dependent rather than against fixtures
 * written to contain the keys:
 *
 *   1. tests spell these as REGEXES -- `\[fiberpool\]`, `fiber\(s\)` -- so a
 *      literal substring match misses them on the backslashes. Lines are
 *      normalised by deleting backslashes before matching.
 *   2. the runtime prints "scriptc RC audit skipped: ..." while the test
 *      matches /RC audit skipped: .../ with no "scriptc". Each key also
 *      yields a prefix-stripped core.
 *
 * A self-test whose fixtures contain the author's own keys is green by
 * construction. The KNOWN-POSITIVE block below is the one that bites.
 *
 *   node fiber-dep-census.mjs <repoRoot>
 *   node fiber-dep-census.mjs --selftest
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);

/* A line as the matcher sees it: regex escapes removed. */
export const norm = (s) => s.split(BS).join("");

export function fiberObservables(repo) {
  const dir = join(repo, "packages", "runtime", "src");
  const out = new Set();
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".c")); } catch { return []; }
  for (const n of names) {
    let txt = "";
    try { txt = readFileSync(join(dir, n), "utf8"); } catch { continue; }
    for (const m of txt.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const lit = m[1];
      if (!/fiber/i.test(lit)) continue;
      // A printed MESSAGE, not a comment body and not an identifier:
      // short, no embedded newline mid-string, and containing a space.
      if (lit.length > 100) continue;
      if (lit.replace(/\\n$/, "").includes(BS + "n")) continue;
      /* EVERY segment between conversions, not just the first. Splitting at
       * the first %ld and keeping only the head discarded "fiber(s) never
       * resumed" -- exactly what request-init.test.ts asserts on. Third face
       * of the same under-sensitivity, found by a known positive again. */
      for (const seg of lit.replace(/\\n$/, "").split(/%[-0-9.l]*[a-z]/)) {
        const key = seg.trim();
        if (key.length < 8 || !key.includes(" ")) continue;
        out.add(key);
        const core = key.replace(/^scriptc:?\s*/, "").trim();
        if (core.length >= 8 && core !== key) out.add(core);
        /* Trailing 2- and 3-word phrases. A test asserts on whatever
         * fragment it finds distinctive: request-init uses just
         * "never resumed". Bounded at >=12 chars so this adds phrases,
         * not noise, and the known-negative controls guard the rest. */
        const w = core.split(/\s+/).filter(Boolean);
        for (const k of [2, 3]) {
          if (w.length > k) {
            const tail = w.slice(-k).join(" ");
            if (tail.length >= 12) out.add(tail);
          }
        }
      }
    }
  }
  return [...out].sort();
}

export function classifyLine(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "COMMENT";
  const excl = /![A-Za-z0-9_.]*\.(startsWith|includes)\s*\(/.test(t);
  if (excl && !/expect\s*\(/.test(t)) return "TOLERANT";
  return "DEPENDENT";
}

function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (["node_modules", ".git", "build", "dist"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
}

export function census(repo, keys) {
  const files = [];
  for (const r of [join(repo, "tests"), join(repo, "packages")]) walk(r, files);
  const sites = [];
  for (const f of files) {
    let txt = "";
    try { txt = readFileSync(f, "utf8"); } catch { continue; }
    const flat = norm(txt);
    if (!keys.some((k) => flat.includes(k))) continue;
    const dep = [];
    txt.split(NL).forEach((l, i) => {
      const n = norm(l);
      const hit = keys.find((k) => n.includes(k));
      if (!hit) return;
      const v = classifyLine(l);
      if (v === "DEPENDENT") dep.push({ line: i + 1, key: hit, text: l.trim().slice(0, 110) });
    });
    if (dep.length === 0) continue;
    /* KNOB-AWARE means the SAME observable asserted both ways. A file-level
     * test for any `not.toContain` anywhere labelled fetch-dispatcher --
     * the known-BROKEN site -- as knob-aware, which is the most dangerous
     * wrong label this tool could print. */
    const branched = dep.some((h) => {
      const k = h.key;
      const pos = new RegExp("(?<!not)\\.to(Contain|Match)\\([^)]*" +
        k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 20));
      const neg = new RegExp("not\\.to(Contain|Match)\\([^)]*" +
        k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 20));
      return pos.test(norm(txt)) && neg.test(norm(txt));
    });
    sites.push({
      file: f.split(BS).join("/").replace(/^.*\/(tests|packages)\//, "$1/"),
      dep, branched,
    });
  }
  return sites;
}

function selftest() {
  const unit = [
    ["classA regex with escaped parens (the RED site's exact form)",
     '    ).toMatch(/RC audit skipped: 1 fiber' + BS + '(s' + BS + ') never resumed/);', "DEPENDENT"],
    ["classB regex with escaped brackets",
     '    const m = /^' + BS + '[fiberpool' + BS + '] window freed=(d+)/.exec(line);', "DEPENDENT"],
    ["classA via toContain", '          ).toContain("never resumed");', "DEPENDENT"],
    ["NEG: tolerant filter", '      !l.startsWith("scriptc RC audit skipped:") &&', "TOLERANT"],
    ["NEG: tolerant includes", '      !line.includes("[fiberpool] window") &&', "TOLERANT"],
    ["NEG: line comment", '//     scriptc RC audit skipped: 4 fiber(s) never resumed', "COMMENT"],
    ["NEG: block comment", ' * before auditing when a fiber never resumed -- so the', "COMMENT"],
    ["expect+startsWith is still DEPENDENT",
     '      expect(l.startsWith("scriptc RC audit skipped:")).toBe(true);', "DEPENDENT"],
  ];
  let pass = 0, fail = 0;
  for (const [name, line, want] of unit) {
    const got = classifyLine(line);
    if (got === want) { pass++; console.log("  PASS  " + name); }
    else { fail++; console.log("  FAIL  " + name + " got=" + got + " want=" + want); }
  }

  /* KNOWN POSITIVES -- the block that caught two real defects. These are
   * sites independently established as fiber-dependent; the census must
   * find every one, and must NOT flag the two tolerant filters. */
  const repo = process.argv[3] ?? "G:/blocks/slice-wt";
  const keys = fiberObservables(repo);
  const sites = census(repo, keys);
  const found = new Map(sites.map((s) => [s.file, s]));
  const must = [
    ["tests/harness/fetch-dispatcher.test.ts", 627],
    ["tests/harness/request-init.test.ts", null],
    ["tests/harness/fiber-pool-decay.test.ts", 64],
  ];
  const mustNot = ["tests/harness/differential-suite.ts", "tests/harness/llvm-differential-suite.ts"];
  console.log("");
  for (const [f, ln] of must) {
    const s = found.get(f);
    const ok = s && (ln === null || s.dep.some((d) => d.line === ln));
    if (ok) { pass++; console.log("  PASS  KNOWN POSITIVE found: " + f + (ln ? ":" + ln : "")); }
    else { fail++; console.log("  FAIL  KNOWN POSITIVE MISSED: " + f + (ln ? ":" + ln : "")); }
  }
  for (const f of mustNot) {
    if (!found.has(f)) { pass++; console.log("  PASS  KNOWN NEGATIVE not flagged: " + f); }
    else { fail++; console.log("  FAIL  tolerant site wrongly flagged: " + f); }
  }
  console.log("");
  console.log("CENSUS-SELFTEST " + (fail === 0 ? "ARMED" : "BROKEN") +
    " pass=" + pass + " fail=" + fail);
  return fail === 0 ? 0 : 1;
}

const arg = process.argv[2];
if (arg === "--selftest") process.exit(selftest());
if (!arg) { console.error("usage: fiber-dep-census.mjs <repoRoot> | --selftest"); process.exit(2); }
const keys = fiberObservables(arg);
console.log("KEYS from packages/runtime/src (" + keys.length + "):");
for (const k of keys) console.log("  " + JSON.stringify(k.slice(0, 90)));
console.log("");
let n = 0;
for (const s of census(arg, keys)) {
  console.log(s.file + (s.branched ? "   [knob-aware: both branches]" : ""));
  for (const h of s.dep) { n++; console.log("    :" + h.line + "  " + h.text); }
}
console.log("");
console.log("FIBER-DEP-CENSUS dependent_sites=" + n);
