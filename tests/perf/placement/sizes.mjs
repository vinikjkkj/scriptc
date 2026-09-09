/* THE SIZE SHAPE the mean could not show, differenced between two runs.
 *
 *   node sizes.mjs <control.txt> <burst.txt> [--top N] [--site SUBSTR]
 *   node sizes.mjs --selftest
 *
 * Reads the records `-DSCR_PROF_SIZEHIST` adds to a scr_prof dump:
 *
 *   PROFEXACT <lo> <count>          process-wide, 8-byte buckets to 8 KiB;
 *                                   `lo` is the FLOOR of the bucket, which
 *                                   covers [lo, lo+8)
 *   PROFHIST  <rva> b:count ... <name>   per site, octave b covers
 *                                        [2^b, 2^(b+1))
 *   PROF-SIZEHIST-TOTAL rows=.. noted=.. over8k=..
 *
 * WHY IT EXISTS. The alloc lane gave count and total bytes, so one site read
 * as 1,350,463 calls at a mean of 998 B — and that turned out to be two
 * populations: ~87% of the calls a 32-byte first sizing, ~97% of the bytes
 * repeated doubling on a minority of arrays. The mean sat between them and
 * described neither. Anything proposed from it would have been a policy for
 * a population that does not exist.
 *
 * THE TWO TABLES ANSWER DIFFERENT QUESTIONS and both are printed. The octave
 * histogram is per SITE and shows bimodality (32 B and 8 KiB are six octaves
 * apart). The exact table is process-WIDE and is the only one that can tell
 * 312 from 328 — two registered predictions turn on exactly that, and an
 * octave bucket merges them.
 *
 * IT REFUSES A SILENT ZERO. A dump with no PROFEXACT/PROFHIST records says
 * SIZEHIST ABSENT by name rather than printing an empty table: a build
 * without `-DSCR_PROF_SIZEHIST` emits none, and "no sizes recorded" and "the
 * hooks were never compiled" must not read alike. `over8k` is echoed because
 * those allocations are outside the exact table and their absence from it is
 * not a zero.
 */
import { readFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const selftest = argv.includes("--selftest");
const topIdx = argv.indexOf("--top");
const TOP = topIdx >= 0 ? Number(argv[topIdx + 1]) : 25;
const siteIdx = argv.indexOf("--site");
const SITE = siteIdx >= 0 ? argv[siteIdx + 1] : null;
/* topIdx/siteIdx are -1 when the flag is absent, so an unguarded
 * `i !== topIdx + 1` excludes index 0 -- the first FILE. Caught by the
 * refusal-path control: two real dumps printed usage instead of the
 * SIZEHIST ABSENT line, because the first path had been filtered away. */
const files = argv.filter(
  (a, i) =>
    !a.startsWith("--") &&
    !(topIdx >= 0 && i === topIdx + 1) &&
    !(siteIdx >= 0 && i === siteIdx + 1),
);

function parse(text, label) {
  const exact = new Map();
  const hist = new Map();
  let total = null;
  let recs = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("PROFEXACT ")) {
      const p = line.split(" ");
      exact.set(Number(p[1]), (exact.get(Number(p[1])) ?? 0) + Number(p[2]));
      recs++;
    } else if (line.startsWith("PROFHIST ")) {
      const p = line.split(" ");
      const buckets = [];
      let i = 2;
      for (; i < p.length && /^\d+:\d+$/.test(p[i]); i++) {
        const [b, c] = p[i].split(":").map(Number);
        buckets[b] = (buckets[b] ?? 0) + c;
      }
      const name = p.slice(i).join(" ");
      const key = p[1] + "|" + name;
      const prev = hist.get(key) ?? { name, buckets: [] };
      for (let b = 0; b < buckets.length; b++) {
        if (buckets[b]) prev.buckets[b] = (prev.buckets[b] ?? 0) + buckets[b];
      }
      hist.set(key, prev);
      recs++;
    } else if (line.startsWith("PROF-SIZEHIST-TOTAL")) total = line;
  }
  if (recs === 0) {
    console.error(
      label +
        ": SIZEHIST ABSENT — no PROFEXACT or PROFHIST records. The build carried" +
        " no -DSCR_PROF_SIZEHIST. This is not a measurement that no sizes were" +
        " recorded.",
    );
    process.exit(2);
  }
  return { exact, hist, total, recs };
}

function diffExact(a, b) {
  const keys = new Set([...a.exact.keys(), ...b.exact.keys()]);
  const rows = [];
  for (const k of keys) {
    const d = (b.exact.get(k) ?? 0) - (a.exact.get(k) ?? 0);
    if (d !== 0) rows.push({ lo: k, delta: d });
  }
  rows.sort((x, y) => y.delta - x.delta);
  return rows;
}

function report(ctl, bst) {
  console.log("control " + (ctl.total ?? "(no PROF-SIZEHIST-TOTAL)"));
  console.log("burst   " + (bst.total ?? "(no PROF-SIZEHIST-TOTAL)"));
  console.log("");
  console.log("EXACT sizes the burst added (bucket covers [lo, lo+8)):");
  console.log("        lo     delta       MiB");
  const rows = diffExact(ctl, bst);
  for (const r of rows.slice(0, TOP)) {
    console.log(
      String(r.lo).padStart(10) +
        String(r.delta).padStart(10) +
        ((r.lo * r.delta) / 1048576).toFixed(2).padStart(10),
    );
  }
  const tot = rows.reduce((s, r) => s + r.delta, 0);
  console.log("(" + rows.length + " distinct sizes moved, " + tot + " allocations)");

  console.log("");
  console.log("PER-SITE octave shape (bucket b covers [2^b, 2^(b+1)) ):");
  const sites = [...bst.hist.entries()]
    .map(([k, v]) => {
      const a = ctl.hist.get(k);
      const d = [];
      let n = 0;
      for (let b = 0; b < 40; b++) {
        const x = (v.buckets[b] ?? 0) - (a ? a.buckets[b] ?? 0 : 0);
        if (x !== 0) d[b] = x;
        n += x;
      }
      return { name: v.name, d, n };
    })
    .filter((s) => s.n > 0 && (SITE === null || s.name.includes(SITE)));
  sites.sort((x, y) => y.n - x.n);
  for (const s of sites.slice(0, TOP)) {
    const parts = [];
    for (let b = 0; b < 40; b++) {
      if (s.d[b]) parts.push(b + "[" + 2 ** b + "]:" + s.d[b]);
    }
    console.log(String(s.n).padStart(10) + "  " + s.name);
    console.log("            " + parts.join("  "));
  }
}

if (selftest) {
  /* Answers are arithmetic, and the case that matters is the BIMODAL one: a
   * site with 900 allocations at 32 B and 100 at 8 KiB has a mean of 830 B
   * and no allocation anywhere near it. A reader that reported the mean
   * would describe a population that does not exist. */
  const ctl = parse(
    ["PROFEXACT 32 100", "PROFHIST aa 5:100 x.c:1", "PROF-SIZEHIST-TOTAL rows=1 noted=100 over8k=0"].join("\n"),
    "st-ctl",
  );
  const bst = parse(
    [
      "PROFEXACT 32 1000",
      "PROFEXACT 328 500",
      "PROFHIST aa 5:1000 13:100 x.c:1",
      "PROF-SIZEHIST-TOTAL rows=1 noted=1600 over8k=0",
    ].join("\n"),
    "st-bst",
  );
  const ex = diffExact(ctl, bst);
  const at = (lo) => ex.find((r) => r.lo === lo)?.delta ?? 0;
  const site = [...bst.hist.values()][0];
  const ctlSite = [...ctl.hist.values()][0];
  const cases = [
    ["32 B delta", at(32), 900],
    ["328 B delta (absent from control)", at(328), 500],
    ["a size present in both cancels", at(999), 0],
    ["octave 5 delta", (site.buckets[5] ?? 0) - (ctlSite.buckets[5] ?? 0), 900],
    ["octave 13 delta (the second mode)", (site.buckets[13] ?? 0) - (ctlSite.buckets[13] ?? 0), 100],
    ["the two modes are 8 octaves apart, not one mean", 13 - 5, 8],
  ];
  let bad = 0;
  for (const [what, got, want] of cases) {
    const ok = got === want;
    if (!ok) bad++;
    console.log((ok ? "ok   " : "FAIL ") + what + ": got " + got + " want " + want);
  }
  console.log("");
  console.log(bad === 0 ? "SELFTEST ok" : "SELFTEST FAILED (" + bad + ")");
  process.exit(bad === 0 ? 0 : 1);
}

if (files.length < 2) {
  console.error("usage: node sizes.mjs <control.txt> <burst.txt> [--top N] [--site SUBSTR]");
  console.error("  or: node sizes.mjs --selftest");
  process.exit(2);
}
for (const f of files.slice(0, 2)) {
  if (!existsSync(f)) {
    console.error("sizes: no such file " + f + " — could not look");
    process.exit(2);
  }
}
report(parse(readFileSync(files[0], "utf8"), files[0]), parse(readFileSync(files[1], "utf8"), files[1]));
