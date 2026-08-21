// immortalrel.mjs <file.c> — the immortal-STATIC ownership ceiling, for
// EVERY immortal family the emitter has, not just string literals.
//
// `litrel.mjs` counted one family (`sc_lit_`) because that was the one
// being priced at the time; the elision that followed took zapo's image
// from 30,477,312 to 25,704,448 bytes. The emitter interns FIVE kinds of
// immortal (`rc == SIZE_MAX`) static, and the other four still bind into
// ordinary owned temps:
//
//   sc_lit_   interned string literal          -- elided, the CONTROL
//   sc_unit_  unit arm of a union (undefined/null)
//   sc_re_    regex literal, one per (pattern, flags)
//   sc_tsa_   tagged-template strings array, one per SITE
//   sc_co_    class object (a class as a value)
//
// Every one of them carries the same argument verbatim: `scr_X_retain` is
// `if (o && o->rc != SIZE_MAX) o->rc++` and `scr_X_release` is
// `if (!o || o->rc == SIZE_MAX) return`, so on such a value both are
// exactly no-ops. Three of the four even say so in the emitter's own
// comments -- "the +1 retain is a no-op on immortals but keeps the
// owned-temps discipline uniform" -- which makes the cost deliberate and
// unpriced, and that is what this counts.
//
// Counted PER FUNCTION, because `sc_tN` numbering restarts and a global
// name set would cross-attribute releases between functions.
//
// SOURCE LINES, not `.text` bytes. estado-imagesize.md §11.3 is the
// standing warning that they do not transfer -- clang tail-merges
// epilogues. Use this to size a candidate, then price it on a real build.
//
//   node immortalrel.mjs <program>.c
//   node immortalrel.mjs --self-test
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

const FAMILIES = ["lit", "unit", "re", "tsa", "co"];

const FN_OPEN = /^(?:static\s+)?[A-Za-z_][\w *]*\bsc_[a-z]+_[\w]+\s*\([^;]*\)\s*\{\s*$/;
// `Type *sc_tN = <init>;` — one declaration of one refcounted temp.
const DECL = /^\s*[A-Za-z_]\w* \*(sc_t\d+) = (.+);\s*$/;
// `scr_<kind>_release(sc_tN);` on a line of its own.
const REL = /^\s*scr_[a-z0-9]+_release\((sc_t\d+)\);\s*$/;
// The initialiser forms that name an immortal static, with or without the
// no-op retain around them and with or without a cast.
const IMMORTAL_INIT =
  /^(?:scr_[a-z0-9]+_retain\()?(?:\([A-Za-z_]\w* \*\))?&(sc_(?:lit|unit|re|tsa|co)_\d+)\)?$/;

export async function scan(stream) {
  const perFamily = Object.fromEntries(FAMILIES.map((f) => [f, { temps: 0, retained: 0, releases: 0 }]));
  const other = { temps: 0, releases: 0 };
  let fns = 0;
  let lines = 0;
  let unattributedReleases = 0;
  let map = new Map(); // sc_tN -> family, for the function being read
  let mortal = new Set();

  const flush = () => { map = new Map(); mortal = new Set(); };

  const handle = (line) => {
    lines++;
    if (line === "}") { flush(); return; }
    if (FN_OPEN.test(line)) { fns++; flush(); return; }
    let m = DECL.exec(line);
    if (m) {
      const im = IMMORTAL_INIT.exec(m[2]);
      if (im) {
        const fam = /^sc_([a-z]+)_/.exec(im[1])[1];
        map.set(m[1], fam);
        perFamily[fam].temps++;
        if (m[2].startsWith("scr_")) perFamily[fam].retained++;
      } else {
        mortal.add(m[1]);
        other.temps++;
      }
      return;
    }
    m = REL.exec(line);
    if (m) {
      const fam = map.get(m[1]);
      if (fam) perFamily[fam].releases++;
      else if (mortal.has(m[1])) other.releases++;
      else unattributedReleases++;
    }
  };

  let carry = "";
  for await (const chunk of stream) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("latin1");
    const buf = carry + text;
    const parts = buf.split("\n");
    carry = parts.pop() ?? "";
    for (const p of parts) handle(p);
  }
  if (carry !== "") handle(carry);
  return { perFamily, other, fns, lines, unattributedReleases };
}

/* ------------------------------------------------------------------ *
 * self-test: a file whose counts are known by construction.
 *
 * The two things that can silently break this counter are (a) the
 * per-function reset -- without it a release in function 2 is charged to a
 * same-numbered temp in function 1 -- and (b) the family classifier. Both
 * are asserted, and the negative control asserts that an ORDINARY temp's
 * release is NOT counted as immortal, because a counter that says
 * "everything is elidable" is as useless as one that says nothing is.
 * ------------------------------------------------------------------ */
const SELF_SRC = [
  'static ScrStr *sc_f_one(void) {',
  '  ScrStr *sc_t0 = (ScrStr *)&sc_lit_3;',
  '  ScrUnion *sc_t1 = (ScrUnion *)&sc_unit_0;',
  '  ScrRegex *sc_t2 = scr_regex_retain(&sc_re_1);',
  '  ScrArr *sc_t3 = scr_arr_retain(&sc_tsa_0);',
  '  ScrClassObj *sc_t4 = scr_classobj_retain(&sc_co_2);',
  '  ScrStr *sc_t5 = scr_str_concat(sc_t0, sc_t0);',
  '  if (scr_exc_pending()) {',
  '    scr_union_release(sc_t1);',
  '    scr_regex_release(sc_t2);',
  '    scr_str_release(sc_t5);',
  '    return NULL;',
  '  }',
  '  scr_union_release(sc_t1);',
  '  scr_regex_release(sc_t2);',
  '  scr_arr_release(sc_t3);',
  '  scr_classobj_release(sc_t4);',
  '  scr_str_release(sc_t5);',
  '  return sc_t5;',
  '}',
  '',
  'static void sc_f_two(void) {',
  // sc_t1 here is a MORTAL string. If the per-function reset is missing it
  // inherits function one's `unit` family and this release is miscounted.
  '  ScrStr *sc_t1 = scr_str_new("x", 1);',
  '  scr_str_release(sc_t1);',
  '}'
].join('\n') + '\n';

async function selfTest() {
  let bad = 0;
  const check = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? "ok   " : "FAIL ") + label + "  got " + JSON.stringify(got) + (ok ? "" : "  want " + JSON.stringify(want)));
    if (!ok) bad++;
  };
  const r = await scan(Readable.from([SELF_SRC]));
  check("functions", r.fns, 2);
  check("lit temps", r.perFamily.lit.temps, 1);
  check("lit retained (post-elision form has none)", r.perFamily.lit.retained, 0);
  check("lit releases", r.perFamily.lit.releases, 0);
  check("unit temps", r.perFamily.unit.temps, 1);
  check("unit releases (guard + normal path)", r.perFamily.unit.releases, 2);
  check("re temps", r.perFamily.re.temps, 1);
  check("re retained", r.perFamily.re.retained, 1);
  check("re releases", r.perFamily.re.releases, 2);
  check("tsa temps", r.perFamily.tsa.temps, 1);
  check("tsa releases", r.perFamily.tsa.releases, 1);
  check("co temps", r.perFamily.co.temps, 1);
  check("co releases", r.perFamily.co.releases, 1);
  // the negative controls
  check("ordinary temps (sc_t5 and function two's sc_t1)", r.other.temps, 2);
  check("ordinary releases NOT charged to a family", r.other.releases, 3);
  check("unattributed releases", r.unattributedReleases, 0);

  // the streaming control: same bytes, 5-byte chunks, identical answer
  const chunks = [];
  for (let i = 0; i < SELF_SRC.length; i += 5) chunks.push(SELF_SRC.slice(i, i + 5));
  const r2 = await scan(Readable.from(chunks));
  check("chunked scan identical", JSON.stringify(r2) === JSON.stringify(r), true);

  console.log(bad === 0 ? "\nSELF-TEST PASS" : "\nSELF-TEST FAILED (" + bad + ")");
  return bad;
}

async function main() {
  const file = process.argv[2];
  if (file === "--self-test") process.exit(await selfTest() === 0 ? 0 : 1);
  if (!file) {
    console.error("usage: node immortalrel.mjs <program>.c | --self-test");
    process.exit(2);
  }
  const r = await scan(createReadStream(file, { encoding: "latin1", highWaterMark: 1 << 22 }));
  const n = (x) => x.toLocaleString("en-US").padStart(12);
  console.log("file  " + file);
  console.log("lines " + n(r.lines) + "   functions " + n(r.fns));
  console.log("");
  console.log("  family      temps        retains     releases   rel/temp");
  let totalRel = 0;
  let totalTemps = 0;
  for (const f of FAMILIES) {
    const d = r.perFamily[f];
    totalRel += d.releases;
    totalTemps += d.temps;
    console.log("  sc_" + (f + "_").padEnd(7) + n(d.temps) + n(d.retained) + n(d.releases) +
      "  " + (d.temps ? (d.releases / d.temps).toFixed(2) : "-").padStart(8));
  }
  console.log("  " + "-".repeat(58));
  console.log("  IMMORTAL   " + n(totalTemps) + n(0) + n(totalRel));
  console.log("  mortal     " + n(r.other.temps) + n(0) + n(r.other.releases));
  console.log("  unattributed release lines " + n(r.unattributedReleases));
  const allRel = totalRel + r.other.releases + r.unattributedReleases;
  console.log("");
  console.log("  immortal share of ALL release LINES  " +
    (allRel ? ((totalRel / allRel) * 100).toFixed(2) : "0.00") + "%   (" +
    totalRel.toLocaleString("en-US") + " of " + allRel.toLocaleString("en-US") + ")");
  console.log("");
  console.log("SOURCE lines, not .text bytes. Price the candidate on a real build.");
}

main().catch((e) => { console.error(e); process.exit(1); });
