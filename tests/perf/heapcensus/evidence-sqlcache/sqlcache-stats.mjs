#!/usr/bin/env node
/* sqlcache-stats.mjs -- runs from the committed directory with NO arguments
 * and regenerates RESULTS.txt.
 *
 * It answers one question from data ALREADY in the tree, with no build and
 * no run: of the 4,376-byte class that is 22.3% of the stackless peak
 * transient, how much is really SQLite's page cache, and is the ceiling that
 * holds it a SET value or an inherited one.
 *
 * FLOW vs POPULATION is kept apart on purpose:
 *   PROF / PROFHIST   = FLOW       (every allocation of the whole run)
 *   HCPKSIZE          = POPULATION at the peak instant
 *   HCSIZE            = POPULATION at shutdown
 * The octave table is FLOW and is used ONLY to eliminate rival sites; every
 * memory figure below it is POPULATION.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HC = dirname(HERE);
const PEAK = join(HC, "evidence-peakvar");

const out = [];
const say = (s) => out.push(s === undefined ? "" : s);
const short = (p) =>
  p.replace(/\\/g, "/").replace(/^<repo>\//, "").replace(/^[A-Za-z]:\/.*?\/(packages|tests)\//, "$1/");

const PROFS = [
  ["postfix/sa", join(HC, "evidence-postfix", "sa.prof.txt")],
  ["postfix/sb", join(HC, "evidence-postfix", "sb.prof.txt")],
  ["idle/on", join(HC, "evidence-idle", "on.prof.txt")],
  ["idle/off", join(HC, "evidence-idle", "off.prof.txt")],
  ["idle/long", join(HC, "evidence-idle", "long.prof.txt")],
  ["idle/half-on", join(HC, "evidence-idle", "half-on.prof.txt")],
  ["megapair/m1", join(HC, "evidence-megapair", "m1.prof.txt")],
  ["megapair/m2", join(HC, "evidence-megapair", "m2.prof.txt")],
];

/* PROFHIST <siteid> <band>:<count> ... <file:line>, band = floor(log2(size)),
 * so band 12 is the octave [4096, 8192) and 4,376 lives in it. */
function octave12(path) {
  const rows = [];
  for (const raw of readFileSync(path, "latin1").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith("PROFHIST ")) continue;
    const f = line.split(" ");
    const where = f[f.length - 1];
    for (let i = 2; i < f.length - 1; i++) {
      if (f[i].startsWith("12:")) rows.push([Number(f[i].slice(3)), short(where)]);
    }
  }
  return rows.sort((a, b) => b[0] - a[0]);
}

say("SQLITE PAGE CACHE -- IS THE 4,376 CLASS A DEFAULT OR A CHOICE?");
say("==============================================================");
say();
say("1. OCTAVE 12 [4096, 8192) BY SITE -- FLOW, not population.");
say("   Every committed *.prof.txt. Rows above 100 allocations only;");
say("   the tail is <= 15 allocations each in every run.");
say();
say("   run            allocs  site");
for (const [tag, path] of PROFS) {
  let n = 0;
  for (const [count, where] of octave12(path)) {
    if (count < 100) continue;
    say("   " + tag.padEnd(13) + " " + String(count).padStart(6) + "  " + where);
    n++;
  }
  if (n === 0) say("   " + tag.padEnd(13) + "      -  (no site above 100)");
}
say();
say("   Two sites carry real traffic in this octave and the LARGER one");
say("   cannot produce 4,376: scr_arr_grow (scr_array.c:390-399) doubles");
say("   cap from 4 and asks for cap * sizeof(uint64_t), so `want` is always");
say("   a power of two -- in octave 12 that is EXACTLY 4096 and nothing");
say("   else. scr_heap_census.h is the instrument itself (ARM_SIZE 5113).");
say("   The residue is vendor/sqlite/sqlite3.c:28035 = sqlite3MemMalloc.");
say();

function sizes(tag, prefix) {
  const txt = readFileSync(join(PEAK, tag + ".heapcen.txt"), "latin1");
  const m = new Map();
  for (const raw of txt.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith(prefix + " ")) continue;
    const f = line.split(" ");
    m.set(Number(f[1]), { n: Number(f[2]), bytes: Number(f[3]) });
  }
  return m;
}

const TAGS = readdirSync(PEAK)
  .filter((f) => /^p\d+\.heapcen\.txt$/.test(f))
  .map((f) => f.slice(0, f.length - ".heapcen.txt".length))
  .sort();
const ARM = {};
for (const t of TAGS) {
  const man = readFileSync(join(PEAK, t + ".manifest.txt"), "latin1").replace(/\r/g, "");
  ARM[t] = /^arm\s+(\S+)/m.exec(man)[1];
}

say("2. POPULATION OF THE 4,376 CLASS -- HCPKSIZE (peak) vs HCSIZE (shutdown)");
say();
say("   run  arm  peak blocks   peak bytes   b/blk   shutdown blocks");
const peakN = { SL: [], FB: [] };
for (const t of TAGS) {
  const pk = sizes(t, "HCPKSIZE").get(4376);
  const st = sizes(t, "HCSIZE").get(4376);
  peakN[ARM[t]].push(pk.n);
  say(
    "   " + t + "   " + ARM[t] + "  " + String(pk.n).padStart(11) + "  " +
    String(pk.bytes).padStart(11) + "  " + String(pk.bytes / pk.n).padStart(6) +
    "   " + (st === undefined ? "ABSENT" : String(st.n))
  );
}
say();
say("   b/blk is 4624, NOT 4376: scr_heap_census.h:167 accumulates");
say("   `size + overhead` from PROCESS_HEAP_ENTRY, and this class carries");
say("   248 B of CRT heap overhead per block (5.66%). A `count x 4376`");
say("   figure understates the committed footprint by exactly that much.");
say();

const PAGE = 4096, SZEXTRA = 216, PGHDR1 = 56;
const szAlloc = PAGE + SZEXTRA + PGHDR1;
const nMax = (kb) => Math.floor((1024 * kb) / 4232);
const worst = Math.max.apply(null, peakN.SL.concat(peakN.FB));

say("3. THE CEILING, AND WHETHER IT BINDS");
say();
say("   szAlloc   = " + PAGE + " + " + SZEXTRA + " + " + PGHDR1 + " = " + szAlloc + "   (sqlite3.c:58472)");
say("   CRT block = szAlloc + 8          = " + (szAlloc + 8) + "   (sqlite3.c:28035)");
say("   numberOfCachePages (sqlite3.c:57021) divides by PCache's own");
say("   szPage + szExtra = 4096 + 136 = 4232, NOT by szAlloc.");
say();
say("   cache_size   pages/conn   max peak population   binds?");
for (const kb of [2000, 16000]) {
  const cap = nMax(kb);
  say(
    "   -" + String(kb).padEnd(11) + String(cap).padStart(10) + "   " +
    String(worst).padStart(19) + "   " + (cap < worst ? "YES" : "no")
  );
}
say();
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
say("   stackless peak mean " + mean(peakN.SL).toFixed(1) + " blocks;" +
    " fiber peak mean " + mean(peakN.FB).toFixed(1) + ".");
say("   The SHIPPING ceiling (-16000 => " + nMax(16000) + " pages/connection)");
say("   sits above every run: the largest peak population, " + worst + ", is");
say("   " + ((worst / nMax(16000)) * 100).toFixed(1) + "% of it. The knob is NOT what bounds");
say("   this population at the peak.");
say("   Stock SQLite's -2000 (" + nMax(2000) + " pages) WOULD bind, at " +
    ((nMax(2000) / worst) * 100).toFixed(1) + "% of the");
say("   measured peak -- which is the trade scr_async.c:2498-2505 records as");
say("   already measured and rejected (+6.65 ms/request, +74.1%).");
say();

say("4. HOW MANY PAGE CACHES");
say();
say("   run  HCPKSIZE 4104 (peak)  HCSIZE 4104 (shutdown)");
for (const t of TAGS) {
  const pk = sizes(t, "HCPKSIZE").get(4104);
  const st = sizes(t, "HCSIZE").get(4104);
  say(
    "   " + t + "   " + String(pk ? pk.n : 0).padStart(19) + "  " +
    String(st ? st.n : 0).padStart(22)
  );
}
say();
say("   4104 = sqlite3MemMalloc(4096) + 8, the un-headered 4 KiB SQLite ask.");
say("   Two blocks in all six runs, at the peak AND at shutdown, both arms:");
say("   this population does not scale with the load. It is reported as a");
say("   SIZE class, not as an identification -- the peak census carries no");
say("   site id, so nothing here names which SQLite caller owns those two.");
say();

writeFileSync(join(HERE, "RESULTS.txt"), out.join("\n") + "\n");
process.stdout.write(out.join("\n") + "\n");
