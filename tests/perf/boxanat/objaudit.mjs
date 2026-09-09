#!/usr/bin/env node
// objaudit.mjs — every place the runtime decides something about an OBJ dyn,
// and WHAT HAPPENS THERE to a kind the site has never heard of.
//
//   node objaudit.mjs <runtime-src-dir> [--list] [--class <c>] [--json]
//   node objaudit.mjs <runtime-src-dir> --check <manifest.tsv>
//   node objaudit.mjs --self-test
//
// WHY THIS EXISTS. Boxing a record into an `unknown` slot materialises the
// whole reachable subtree (tests/perf/boxanat). The fix under consideration is
// a by-reference box, and the shape of that fix was chosen on this argument:
//
//     "a new dyn kind makes every reader that has not been taught about it
//      REFUSE loudly, where a lazily-emptied SCR_DYN_OBJ would answer
//      `{}` — silently, and indistinguishably from a real empty object."
//
// The argument is sound. THE PREMISE IS NOT, and this file is the
// measurement that says so. A new kind fails loudly only where the site is a
// `switch` whose `default:` refuses. The overwhelming majority of these sites
// are not switches at all — they are `if (d->kind != SCR_DYN_OBJ) return
// <default>;` guards on inbound library options, and a kind they have not
// heard of takes the default: the TLS options are silently ignored, `'k' in
// o` is silently false, `qs.stringify` silently returns "".
//
// Two of them are worse than a default. `scr_dyn_truthy` ends in
// `default: return false`, so an unadded object-like kind is FALSY; and
// `scr_dyn_typeof_native` ends in `default: return "undefined"`, so `typeof`
// on it is "undefined". The runtime already knows: scr_dyn_truthy's own
// comment says "the default's unconditional false, which is what an unadded
// kind gets here — is a wrong branch in silence, not a fence."
//
// So the loudness has to be BUILT, not inherited. This file exists to make
// the size of that job a number rather than an impression, and — through
// `--check` — to make it impossible for a new decision site to appear
// without someone classifying it.
//
// WHAT A CLASS MEANS, for whoever does the work:
//
//   loud       the miss path already throws, aborts or refuses by name. A
//              new kind arriving here is correctly refused; nothing to do.
//   silent     the miss path returns a value, breaks, or takes an `else`.
//              A new kind arriving here produces a WRONG ANSWER with no
//              diagnostic. Every one of these needs a decision.
//   nodefault  a `switch` on the kind with no `default:` arm at all. The
//              new kind falls out of the switch entirely; what happens next
//              is whatever the code after the switch does.
//
// WHAT IT DOES NOT DO. It does not know what the right answer IS at any
// site — that is the audit, and the audit is a person. It tells you where
// the sites are, how each one currently fails, and shouts when the set
// changes.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* A "decision" is any line that branches on the OBJ kind, plus any line that
 * reads the OBJ payload arm directly. The second is not redundant: a function
 * can read `v.obj.entries` having established the kind several lines earlier,
 * or in a helper, and those readers are exactly the ones a by-reference box
 * must not reach. */
const PATTERNS = {
  guard_ne: /kind\s*!=\s*SCR_DYN_OBJ\b/,
  test_eq: /kind\s*==\s*SCR_DYN_OBJ\b/,
  case_arm: /case\s+SCR_DYN_OBJ\s*:/,
  arm_read: /v\.obj\./,
};
/* A C function head at column 0. Deliberately loose: a missed head attributes
 * a site to the function above it, which is visible in the report, where a
 * too-strict one would drop the site entirely. */
const FN_HEAD = /^[A-Za-z_][A-Za-z0-9_ *]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
/* A comment line. Prose about SCR_DYN_OBJ is not a decision, and this tree's
 * comments name it constantly. */
const COMMENT = /^\s*(\*|\/\*|\/\/)/;
/* What makes a miss path LOUD. */
const LOUD = /scr_throw|scr_fence|scr_abort|JS_Throw|abort\s*\(|not supported|unsupported|_oom\s*\(/;

export function scanFile(name, text) {
  const lines = text.split(/\r?\n/);
  const sites = new Map();
  let cur = "(file scope)";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && !/^\s/.test(line) && !/^[/*#}]/.test(line)) {
      const m = FN_HEAD.exec(line);
      if (m) cur = m[1];
    }
    if (COMMENT.test(line)) continue;
    const hits = Object.entries(PATTERNS).filter(([, p]) => p.test(line)).map(([k]) => k);
    if (hits.length === 0) continue;
    const key = `${name}\t${cur}`;
    const e = sites.get(key) ?? {
      file: name, fn: cur, first: i + 1,
      guard_ne: 0, test_eq: 0, case_arm: 0, arm_read: 0,
      missClass: null, missAt: null, ctx: line.trim().slice(0, 100),
    };
    for (const h of hits) e[h]++;
    if (hits.includes("case_arm") && e.missClass === null) {
      const d = findDefault(lines, i);
      e.missClass = d.cls;
      e.missAt = d.at;
    }
    sites.set(key, e);
  }
  // A site with no `case` arm is an `if` guard or a bare payload read, and
  // both miss SILENTLY by construction: there is no arm to fall out of, only
  // a default value, an `else`, or a read that was never reached.
  for (const e of sites.values()) if (e.missClass === null) e.missClass = "silent";
  return [...sites.values()];
}

/** The `default:` belonging to the switch that owns the case at `from`, and
 * whether its body refuses or answers. Brace-tracked rather than
 * line-windowed: these switches run to 200 lines and a fixed window silently
 * attributed one switch's default to the next switch along. */
export function findDefault(lines, from) {
  let depth = 0;
  for (let j = from; j < lines.length; j++) {
    const l = lines[j];
    if (/^\s*default\s*:/.test(l) && depth <= 0) {
      const body = lines.slice(j, j + 6).join("\n");
      return { cls: LOUD.test(body) ? "loud" : "silent", at: j + 1 };
    }
    if (!COMMENT.test(l)) {
      for (const ch of l) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
    }
    // Left the switch body without meeting a default.
    if (depth < 0) return { cls: "nodefault", at: null };
  }
  return { cls: "nodefault", at: null };
}

export function scanDir(dir) {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    if (!/\.(c|h)$/.test(f)) continue;
    out.push(...scanFile(f, readFileSync(join(dir, f), "utf8")));
  }
  return out;
}

export function summarise(sites) {
  const s = {
    sites: sites.length,
    guard_ne: 0, test_eq: 0, case_arm: 0, arm_read: 0,
    loud: 0, silent: 0, nodefault: 0,
    files: new Set(),
  };
  for (const e of sites) {
    s.guard_ne += e.guard_ne; s.test_eq += e.test_eq;
    s.case_arm += e.case_arm; s.arm_read += e.arm_read;
    s[e.missClass]++;
    s.files.add(e.file);
  }
  return s;
}

/* MECHANICAL columns: regenerated from the source every run and compared.
 * HUMAN columns: `verdict` and `note`, carried through untouched.
 *
 * The split is the point. The scan can see that scr_weak_dyn_key's default
 * RETURNS rather than throws; it cannot see that what it returns is a REFUSAL
 * DESCRIPTOR whose caller turns it into a throw. Widening the pattern until it
 * caught that would have made it catch things that are not refusals — and in
 * the direction that flatters the argument this file exists to correct. So a
 * person overrides, with a reason, and the override is data. */
const MECH = ["guard_ne", "test_eq", "case_arm", "arm_read", "missClass"];
const COLS = ["file", "fn", ...MECH, "verdict", "note"];

/** The verdict every unclassified site starts at. `--check` FAILS while any
 * remain, so a site cannot reach a merge by being ignored. */
export const REVIEW = "REVIEW";

export function toTsv(sites, prior = null) {
  const carry = new Map();
  if (prior) {
    for (const line of prior.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const c = line.split("\t");
      carry.set(`${c[0]}\t${c[1]}`, { verdict: c[2 + MECH.length] ?? REVIEW, note: c[3 + MECH.length] ?? "" });
    }
  }
  const rows = [COLS.join("\t")];
  for (const e of [...sites].sort((a, b) => a.file.localeCompare(b.file) || a.fn.localeCompare(b.fn))) {
    const h = carry.get(`${e.file}\t${e.fn}`) ?? { verdict: REVIEW, note: "" };
    rows.push([e.file, e.fn, ...MECH.map((c) => String(e[c])), h.verdict, h.note].join("\t"));
  }
  return rows.join("\n") + "\n";
}

/** The guard. A site that appears, disappears, or changes how it fails is a
 * decision somebody has to make, and this is what stops it being made by
 * nobody. */
export function check(sites, manifestText) {
  const want = new Map();
  const verdicts = new Map();
  for (const line of manifestText.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    want.set(`${c[0]}\t${c[1]}`, c.slice(2, 2 + MECH.length).join("\t"));
    verdicts.set(`${c[0]}\t${c[1]}`, c[2 + MECH.length] ?? REVIEW);
  }
  const have = new Map();
  for (const e of sites) {
    have.set(`${e.file}\t${e.fn}`, MECH.map((c) => String(e[c])).join("\t"));
  }
  const added = [...have.keys()].filter((k) => !want.has(k));
  const removed = [...want.keys()].filter((k) => !have.has(k));
  const changed = [...have.keys()].filter((k) => want.has(k) && want.get(k) !== have.get(k))
    .map((k) => `${k}: ${want.get(k)} -> ${have.get(k)}`);
  // A site nobody has decided about is not a passing state. This is the
  // difference between a census and a guard.
  const unclassified = [...have.keys()].filter((k) => (verdicts.get(k) ?? REVIEW) === REVIEW);
  return {
    added, removed, changed, unclassified,
    ok: !added.length && !removed.length && !changed.length && !unclassified.length,
  };
}

function render(sites) {
  const s = summarise(sites);
  const o = [];
  o.push(`OBJAUDIT  ${s.sites} functions in ${s.files.size} files decide something about an OBJ dyn`);
  o.push("");
  o.push(`  kind decisions   ${s.guard_ne + s.test_eq + s.case_arm}`);
  o.push(`    if (kind != OBJ)   ${String(s.guard_ne).padStart(4)}   miss = the default value / the else branch`);
  o.push(`    if (kind == OBJ)   ${String(s.test_eq).padStart(4)}   miss = the else branch`);
  o.push(`    case OBJ:          ${String(s.case_arm).padStart(4)}   miss = the switch's default arm`);
  o.push(`  direct v.obj reads ${String(s.arm_read).padStart(4)}`);
  o.push("");
  o.push("HOW A KIND THIS SITE HAS NOT HEARD OF FAILS HERE:");
  o.push(`  loud      ${String(s.loud).padStart(4)}   throws, aborts or refuses by name`);
  o.push(`  silent    ${String(s.silent).padStart(4)}   returns a value, breaks, or takes the else`);
  o.push(`  nodefault ${String(s.nodefault).padStart(4)}   a kind switch with no default arm at all`);
  const pct = ((s.loud / s.sites) * 100).toFixed(1);
  o.push("");
  o.push(`So ${s.loud} of ${s.sites} sites (${pct}%) refuse a new kind. The rest answer it.`);
  return o.join("\n");
}

function selfTest() {
  const fails = [];
  let n = 0;
  const ok = (name, c) => { n++; if (!c) fails.push(name); };

  // A LOUD switch.
  const loudC = [
    "static int f(const ScrDyn *d) {",
    "  switch (d->kind) {",
    "  case SCR_DYN_OBJ: return 1;",
    "  default: {",
    '    scr_throw_error_msg(SCR_ERR_ERROR, "nope", 4);',
    "  }",
    "  }",
    "}",
  ].join("\n");
  ok("loud default", scanFile("a.c", loudC)[0]?.missClass === "loud");

  // A SILENT switch — scr_dyn_truthy's exact shape, which is the case that
  // decides the whole argument this file exists to settle.
  const silentC = [
    "bool scr_dyn_truthy(const ScrDyn *d) {",
    "  switch (d->kind) {",
    "  case SCR_DYN_OBJ:",
    "  case SCR_DYN_ARR: return true;",
    "  default: return false; /* undefined, null */",
    "  }",
    "}",
  ].join("\n");
  const st = scanFile("a.c", silentC);
  ok("silent default", st[0]?.missClass === "silent");
  ok("attributed to the function", st[0]?.fn === "scr_dyn_truthy");

  // A GUARD is silent by construction, and has no case arm to be misread as
  // one.
  const guardC = [
    "static int g(const ScrDyn *o) {",
    "  if (o->kind != SCR_DYN_OBJ) return 0;",
    "  return (int)o->v.obj.len;",
    "}",
  ].join("\n");
  const gs = scanFile("a.c", guardC);
  ok("guard counted", gs[0]?.guard_ne === 1);
  ok("guard reads the arm too", gs[0]?.arm_read === 1);
  ok("guard is silent", gs[0]?.missClass === "silent");
  ok("guard has no case arm", gs[0]?.case_arm === 0);

  // THE BRACE TRACKING. A line window would attribute the SECOND switch's
  // loud default to the first switch's case, and report a silent site as
  // loud — which is the direction that would let the argument this file
  // corrects stand.
  const twoC = [
    "static int h(const ScrDyn *d) {",
    "  switch (d->kind) {",
    "  case SCR_DYN_OBJ: return 1;",
    "  }",
    "  switch (d->kind) {",
    "  default: scr_throw_error_msg(SCR_ERR_ERROR, \"x\", 1);",
    "  }",
    "}",
  ].join("\n");
  ok("no default is not the next switch's", scanFile("a.c", twoC)[0]?.missClass === "nodefault");

  // COMMENTS ARE NOT DECISIONS. This tree names SCR_DYN_OBJ constantly in
  // prose; counting those would inflate every number here.
  const commentC = [
    "/* SCR_DYN_OBJ is the record's kind, and d->kind == SCR_DYN_OBJ is how",
    " * you test for it; v.obj.entries is its table. */",
    "static int k(void) { return 0; }",
  ].join("\n");
  ok("prose is not a site", scanFile("a.c", commentC).length === 0);
  // ...and the control that says the line above can fail: the same text as
  // CODE must be found.
  ok("the same text as code IS a site",
     scanFile("a.c", "static int k(const ScrDyn *d) {\n  return d->kind == SCR_DYN_OBJ;\n}").length === 1);

  // THE GUARD ITSELF, and the property that makes it a guard rather than a
  // census: it must NOT pass on its own freshly generated output.
  const base = scanFile("a.c", silentC);
  const man = toTsv(base);

  // A fresh manifest is all REVIEW. An unclassified site reaching a merge is
  // the whole thing this exists to stop, so this must fail -- and must fail
  // for that reason, not because of a phantom drift.
  const fresh = check(base, man);
  ok("a fresh manifest does not pass", !fresh.ok);
  ok("...and the reason is that it is unclassified", fresh.unclassified.length === 1);
  ok("...not a phantom drift",
     !fresh.added.length && !fresh.removed.length && !fresh.changed.length);

  const classified = man.replace("	REVIEW	", "	refonly	");
  ok("a classified manifest passes", check(base, classified).ok);

  // Drift, each direction, against the CLASSIFIED manifest -- so a failure
  // here is drift and not the REVIEW gate firing again.
  ok("an added site fails",
     !check(base.concat([{ ...base[0], fn: "brand_new" }]), classified).ok);
  ok("a removed site fails", !check([], classified).ok);
  ok("a reclassified site fails", !check([{ ...base[0], missClass: "loud" }], classified).ok);
  ok("a changed arm-read count fails", !check([{ ...base[0], arm_read: 99 }], classified).ok);

  // Verdicts CARRY across a regeneration. Without this every rescan would
  // silently wipe the audit and the guard would go green by forgetting.
  ok("verdicts carry through a regenerate", toTsv(base, classified).includes("refonly"));
  ok("a carried verdict still passes", check(base, toTsv(base, classified)).ok);

  if (fails.length) {
    console.error("SELF-TEST FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`objaudit self-test: ok (${n} checks)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("usage: objaudit.mjs <runtime-src-dir> [--list] [--class <c>] [--check <m.tsv>] [--json]");
    process.exit(2);
  }
  const sites = scanDir(dir);
  if (args.includes("--check")) {
    const m = args[args.indexOf("--check") + 1];
    const r = check(sites, readFileSync(m, "utf8"));
    if (r.ok) {
      console.log(`objaudit: ok — ${sites.length} sites, all classified in ${m}`);
      return;
    }
    console.error("OBJAUDIT FAILED — every line below is a place a new dyn kind can arrive.");
    if (r.added.length || r.removed.length || r.changed.length) {
      console.error("The set of OBJ decision sites moved. Regenerate with --tsv (it carries");
      console.error("existing verdicts through) and classify what is new.");
      for (const a of r.added) console.error(`  + ${a}`);
      for (const d of r.removed) console.error(`  - ${d}`);
      for (const c of r.changed) console.error(`  ~ ${c}`);
    }
    if (r.unclassified.length) {
      console.error(`${r.unclassified.length} site(s) still at ${REVIEW} — nobody has decided what a`);
      console.error("by-reference box should do here:");
      for (const u of r.unclassified.slice(0, 20)) console.error(`  ? ${u}`);
      if (r.unclassified.length > 20) console.error(`  … and ${r.unclassified.length - 20} more`);
    }
    process.exit(1);
  }
  if (args.includes("--tsv")) {
    const pi = args.indexOf("--merge");
    process.stdout.write(toTsv(sites, pi >= 0 ? readFileSync(args[pi + 1], "utf8") : null));
    return;
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify({ summary: { ...summarise(sites), files: undefined }, sites }, null, 2));
    return;
  }
  console.log(render(sites));
  if (args.includes("--list")) {
    const cls = args.includes("--class") ? args[args.indexOf("--class") + 1] : null;
    console.log("");
    for (const e of sites.filter((x) => !cls || x.missClass === cls)) {
      console.log(
        `${e.missClass.padEnd(9)} ${e.file}:${String(e.first).padEnd(6)} ${e.fn.slice(0, 36).padEnd(36)} ` +
        `ne=${e.guard_ne} eq=${e.test_eq} case=${e.case_arm} arm=${e.arm_read}`,
      );
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("objaudit.mjs")) main();
