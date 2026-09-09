/* WHAT THE HISTORY-SYNC BURST ALLOCATES, per call site, by differencing two
 * runs of the SAME binary.
 *
 *   node profdiff.mjs <control.txt> <burst.txt> [--top N]
 *   node profdiff.mjs --selftest
 *
 * THE PHASE SPLIT IS TWO RUNS, NOT A MID-RUN DUMP, and that is a choice worth
 * defending. scr_prof.h does have scr_prof_report_to() for a phase edge, but
 * NOTHING CALLS IT at one: the markers this investigation cares about
 * (PRESYNC-BASELINE, SYNC-DONE) are the RIG's, written in the parent process,
 * and the child has no seam to fire them through. Adding one would mean a
 * poll inside the allocation hook or a new route in zapo-rest.ts, and both
 * change the thing being measured.
 *
 * The rig already offers a cleaner split. CHUNKS=0 delivers no history at
 * all, so the child pairs, logs in, idles and shuts down having done
 * everything EXCEPT the burst; CHUNKS=8 does the same plus the burst. Both
 * write an ordinary exit report through SCR_PROF_OUT. The per-site difference
 * is the burst's allocation profile, and it needs no new machinery in the
 * runtime, the compiler, or zapo.
 *
 * WHAT IT COSTS, stated rather than left to be discovered. The two runs
 * differ in more than the phase (timing, socket churn, whatever the idle loop
 * did), so a small per-site difference is noise and only large ones are
 * readable. And it is blind to a site that allocates at the SAME rate in both
 * runs -- such a site cancels to zero and drops out.
 *
 * -------------------------------------------------------------------------
 * THE RECORD FORMAT, from tests/perf/prof/scr_prof.h:
 *   PROF <count> <bytes> <freed> <self> <incl> <rva> <rva2> <name>
 *   PROFLIVE <snap> <live> <rva> <name>          (needs -DSCR_PROF_LIVE)
 *   PROF-TOTAL rows=.. count=.. bytes=.. freed=.. lost=.. ...
 *   PROF-LIVE-TOTAL rows=.. livePeak=.. liveNow=.. ...
 *
 * `freed` IS A COUNT OF FREES AT THE **FREE SITE**, NOT BYTES AT THE ALLOC
 * SITE. scr_prof.h line 678 is `r->freed++`, and the row it lands on is the
 * one for the `free()` call location -- a separate row with count=0 and
 * bytes=0. Verified on a real dump: every allocation row carries freed=0
 * while 92 pure free-site rows carry the whole 4,326,100.
 * The first version of this reader computed "kept = bytes - freed" and printed
 * a megabyte figure from it -- a byte total minus a call count -- which came
 * out as "1721.70 MiB allocated, of which 1721.70 MiB never freed" on a
 * process that settles near 100 MiB. The selftest did not catch it: it
 * asserted the arithmetic this file implements, not the SEMANTICS of a field
 * defined in another file. A fixture cannot check a units misreading of an
 * external format; only reading that format's definition can.
 *
 * So what survives is `live` (LIVE lane, BYTES: what the site has allocated
 * and not yet had freed, at the instant of the dump) and `snap` (the same
 * figure sampled when process-wide live was at its high-water). The free
 * RATE, freed/count, is printed because it separates a site that churns from
 * one that accumulates -- but it is a ratio of counts and says nothing about
 * bytes.
 *
 * -------------------------------------------------------------------------
 * IT REFUSES TO REPORT A SILENT ZERO.
 *
 *   A missing or unreadable file is named, and exits 2 -- never an empty
 *   table that reads like "the burst allocated nothing".
 *   A file with no PROF rows says NO ROWS by name.
 *   A burst dump with no PROFLIVE rows says LIVE COLUMN ABSENT, because a
 *   build without -DSCR_PROF_LIVE prints no such row, and a reader that
 *   quietly showed live=0 everywhere would report "nothing survives the
 *   sync" -- the single most wrong answer this tool could give.
 *   PROF-TOTAL's `lost` is echoed: those are allocations the table could not
 *   key, and they are not in this report.
 *
 * --selftest differences two synthetic dumps whose answers are arithmetic,
 * including a site that is IDENTICAL in both runs and must therefore vanish.
 * Run it before trusting a real reading.
 */
import { readFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const selftest = argv.includes("--selftest");
const topIdx = argv.indexOf("--top");
const TOP = topIdx >= 0 ? Number(argv[topIdx + 1]) : 30;
/* topIdx is -1 when --top is absent, so an unguarded `i !== topIdx + 1`
 * excludes index 0 -- the first FILE. It never showed here because every
 * invocation so far passed --top. */
const files = argv.filter((a, i) => !a.startsWith("--") && !(topIdx >= 0 && i === topIdx + 1));

const MB = (b) => (b / 1048576).toFixed(2);

function blank(name, rva) {
  return { name, rva, count: 0, bytes: 0, freed: 0, live: 0, snap: 0, hasLive: false };
}

function parse(text, label) {
  const sites = new Map();
  let total = null;
  let liveTotal = null;
  let profRows = 0;
  let liveRows = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("PROF ")) {
      const p = line.split(" ");
      const name = p.slice(8).join(" ");
      const key = p[6] + "|" + name;
      const cur = sites.get(key) ?? blank(name, p[6]);
      cur.count += Number(p[1]);
      cur.bytes += Number(p[2]);
      cur.freed += Number(p[3]);
      sites.set(key, cur);
      profRows++;
    } else if (line.startsWith("PROFLIVE ")) {
      const p = line.split(" ");
      const name = p.slice(4).join(" ");
      const key = p[3] + "|" + name;
      const cur = sites.get(key) ?? blank(name, p[3]);
      cur.snap += Number(p[1]);
      cur.live += Number(p[2]);
      cur.hasLive = true;
      sites.set(key, cur);
      liveRows++;
    } else if (line.startsWith("PROF-TOTAL")) total = line;
    else if (line.startsWith("PROF-LIVE-TOTAL")) liveTotal = line;
  }
  if (profRows === 0) {
    console.error(
      label +
        ": NO ROWS -- the file has no PROF records. Either the build carried no" +
        " allocation profiler, or it wrote somewhere else. This is not a" +
        " measurement of zero allocations.",
    );
    process.exit(2);
  }
  return { sites, total, liveTotal, profRows, liveRows };
}

function diff(ctl, bst) {
  const keys = new Set([...ctl.sites.keys(), ...bst.sites.keys()]);
  const rows = [];
  for (const k of keys) {
    const a = ctl.sites.get(k) ?? blank("", "");
    const b = bst.sites.get(k) ?? blank("", "");
    const seen = bst.sites.get(k) ?? ctl.sites.get(k);
    rows.push({
      name: seen.name,
      rva: seen.rva,
      count: b.count - a.count,
      bytes: b.bytes - a.bytes,
      freed: b.freed - a.freed,
      live: b.live - a.live,
    });
  }
  return rows;
}

function report(ctl, bst) {
  const all = diff(ctl, bst);
  /* Allocation rows and free rows are DISJOINT in this format; mixing them
   * produced a "freed%" column that read 0.0 everywhere while the totals
   * disagreed by 4.18 million frees. */
  const rows = all.filter((r) => r.count !== 0 || r.bytes !== 0);
  const freeRows = all.filter((r) => r.count === 0 && r.bytes === 0 && r.freed !== 0);
  rows.sort((x, y) => y.bytes - x.bytes);
  freeRows.sort((x, y) => y.freed - x.freed);
  const anyLive = bst.liveRows > 0;
  if (!anyLive) {
    console.log("LIVE COLUMN ABSENT -- the burst dump has no PROFLIVE rows, so");
    console.log("  nothing below says what SURVIVED. Rebuild with -DSCR_PROF_LIVE.");
    console.log("  A zero in a column that was never compiled is not a survivor count.");
    console.log("");
  }
  const tot = rows.reduce((s, r) => s + r.bytes, 0);
  const nAlloc = rows.reduce((s, r) => s + r.count, 0);
  const nFreed = rows.reduce((s, r) => s + r.freed, 0);
  const liveB = rows.reduce((s, r) => s + r.live, 0);
  console.log("sites moved by the burst:         " + rows.length);
  console.log("bytes allocated during the burst: " + MB(tot) + " MiB");
  console.log("allocation calls during burst:    " + nAlloc);
  console.log("free calls during burst (separate rows, free-site attributed): " + nFreed);
  console.log("still live at the dump (BYTES):   " + MB(liveB) + " MiB" +
    (tot > 0 ? "  = " + (100 * liveB / tot).toFixed(3) + "% of what the burst allocated" : ""));
  console.log("");
  console.log("control " + (ctl.total ?? "(no PROF-TOTAL)"));
  console.log("burst   " + (bst.total ?? "(no PROF-TOTAL)"));
  console.log("");
  /* meanB is the registered predictions' discriminator: a site with a
   * large count and a mean near 328 is the uncovered string band, and one
   * near 1328 is the population the census could not attribute. It is a
   * MEAN, so a site that mixes sizes will sit between classes and must not
   * be read as either -- the exact-size histogram is what adjudicates. */
  console.log("  allocMiB   liveMiB   live%     count     meanB  site");
  for (const r of rows.slice(0, TOP)) {
    console.log(
      MB(r.bytes).padStart(10) +
        " " +
        (anyLive ? MB(r.live) : "--").padStart(9) +
        " " +
        (anyLive && r.bytes > 0 ? (100 * r.live / r.bytes).toFixed(2) : "--").padStart(7) +
        " " +
        String(r.count).padStart(9) +
        " " +
        (r.count > 0 ? (r.bytes / r.count).toFixed(0) : "--").padStart(9) +
        "  " +
        r.name,
    );
  }
  if (freeRows.length > 0) {
    console.log("");
    console.log("free sites (disjoint rows; count and bytes are 0 by construction)");
    console.log("     frees  site");
    for (const r of freeRows.slice(0, 8)) {
      console.log(String(r.freed).padStart(10) + "  " + r.name);
    }
  }
}

if (selftest) {
  /* Answers are arithmetic. `alpha` allocates 1000 more blocks of 100 B in
   * the burst and frees none of them. `beta` is IDENTICAL in both runs and
   * must VANISH -- a reader that cannot drop it is reporting the whole
   * program rather than the burst, which is the failure this differencing
   * exists to avoid. `gamma` exists only in the burst and is entirely
   * freed, so it allocated a lot and kept nothing. */
  const ctl = parse(
    [
      "PROF 10 1000 10 0 0 aa 0 alpha",
      "PROF 7 700 7 0 0 bb 0 beta",
      "PROFLIVE 0 0 aa alpha",
      "PROF-TOTAL rows=2 count=17 bytes=1700 freed=1700 lost=0",
    ].join("\n"),
    "selftest-control",
  );
  const bst = parse(
    [
      "PROF 1010 101000 10 0 0 aa 0 alpha",
      "PROF 7 700 7 0 0 bb 0 beta",
      "PROF 5 5000 5 0 0 cc 0 gamma",
      "PROFLIVE 0 100000 aa alpha",
      "PROF-TOTAL rows=3 count=1022 bytes=106700 freed=6700 lost=0",
    ].join("\n"),
    "selftest-burst",
  );
  const rows = diff(ctl, bst);
  const by = (n) => rows.find((r) => r.name === n);
  const cases = [
    ["alpha count", by("alpha").count, 1000],
    ["alpha bytes", by("alpha").bytes, 100000],
    ["alpha freed COUNT (not bytes)", by("alpha").freed, 0],
    ["alpha live", by("alpha").live, 100000],
    ["beta bytes must cancel to 0", by("beta").bytes, 0],
    ["beta count must cancel to 0", by("beta").count, 0],
    ["gamma bytes", by("gamma").bytes, 5000],
    ["gamma freed count", by("gamma").freed, 5],
    ["gamma freed% is 100 of its 5 allocs", Math.round(100 * by("gamma").freed / by("gamma").count), 100],
  ];
  let bad = 0;
  for (const [what, got, want] of cases) {
    const ok = got === want;
    if (!ok) bad++;
    console.log((ok ? "ok   " : "FAIL ") + what + ": got " + got + " want " + want);
  }
  /* And the refusal itself has to fire: a dump with no PROFLIVE must be
   * reported as an absent column, not as zero survivors. */
  const noLive = parse("PROF 1 1 0 0 0 dd 0 delta\nPROF-TOTAL rows=1", "selftest-nolive");
  if (noLive.liveRows !== 0) {
    console.log("FAIL the no-live fixture parsed live rows it does not have");
    bad++;
  } else {
    console.log("ok   a dump without PROFLIVE reports zero live ROWS, not zero survivors");
  }
  console.log("");
  console.log(bad === 0 ? "SELFTEST ok" : "SELFTEST FAILED (" + bad + ")");
  process.exit(bad === 0 ? 0 : 1);
}

if (files.length < 2) {
  console.error("usage: node profdiff.mjs <control.txt> <burst.txt> [--top N]");
  console.error("  control = a run with CHUNKS=0 (no history sync)");
  console.error("  burst   = a run with CHUNKS=8 (the documented workload)");
  console.error("  or: node profdiff.mjs --selftest");
  process.exit(2);
}
for (const f of files.slice(0, 2)) {
  if (!existsSync(f)) {
    console.error("profdiff: no such file " + f + " -- could not look");
    process.exit(2);
  }
}
report(parse(readFileSync(files[0], "utf8"), files[0]), parse(readFileSync(files[1], "utf8"), files[1]));
