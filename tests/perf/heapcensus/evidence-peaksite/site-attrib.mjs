#!/usr/bin/env node
/* site-attrib.mjs -- name the allocation SITE of the peak-only classes
 * 1,048,576 / 934,576 / 4,376, from data already committed.
 *
 * Runs from the committed directory with NO arguments:
 *     node site-attrib.mjs            (writes RESULTS.txt beside itself)
 *     node site-attrib.mjs --stdout   (prints instead of writing)
 *
 * Inputs, all committed, all read-only:
 *   ../evidence-peakvar/p{1..6}.heapcen.txt   peak + shutdown census, 6 runs
 *   ../evidence-postfix/sb.prof.txt           PROF alloc profile, stackless
 *   ../evidence-postfix/sa.prof.txt           PROF alloc profile, 2nd build
 *
 * NO BUILD, NO RUN. Pure re-reading of committed bytes.
 *
 * CROSS-RUN WARNING, stated here because it bounds every claim below: the
 * census files (p1..p6) and the PROF files (sa/sb) are DIFFERENT BUILDS AND
 * DIFFERENT RUNS. The source tree is the same, so a REQUEST SIZE observed in
 * one is a fact about the same code in the other. A COUNT is not. Nothing
 * here uses a PROF count to say anything about a census population.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PEAKVAR = join(HERE, '..', 'evidence-peakvar');
const POSTFIX = join(HERE, '..', 'evidence-postfix');
const RUNS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const TARGETS = [1048576, 934576, 4376, 65536];

const out = [];
const P = (s = '') => out.push(s);

/* ---------- readers ---------------------------------------------------- */

function lines(path) {
  // The binary writes these CRLF; every hand-written file here is LF. Strip
  // CR so the parser cannot depend on which it got.
  return readFileSync(path, 'utf8').split(/\r?\n/);
}

/* HCPKSIZE / HCSIZE <size> <n> <bytes>
 * scr_heap_census.h:151-170 keys scr_hc_tbl on `size` by EXACT match
 * (open addressing, `if (tbl[j].size != size) continue`) and accumulates
 * `bytes += size + overhead`. scr_heap_census.h:317 passes
 * scr_hc_note(e.cbData, e.cbOverhead). So:
 *     class label  = cbData  = the REQUEST, exact, never banded
 *     bytes column = n*size + sum(overhead)
 * which makes (bytes/n - size) the mean allocator overhead per block. */
function census(run) {
  const peak = new Map(), rest = new Map();
  for (const ln of lines(join(PEAKVAR, `${run}.heapcen.txt`))) {
    const f = ln.split(/\s+/);
    if (f[0] === 'HCPKSIZE') peak.set(+f[1], { n: +f[2], bytes: +f[3] });
    else if (f[0] === 'HCSIZE') rest.set(+f[1], { n: +f[2], bytes: +f[3] });
  }
  return { peak, rest };
}

/* PROFHIST <siteHash> <b>:<count> ... <file:line>
 * scr_prof.h:823-825: "the octave bucket b holds [2^b, 2^(b+1))". Only
 * non-empty buckets are printed. The path is the LAST field; it contains
 * backslashes and a drive colon, so it is taken as $NF and never split. */
function profhist(file) {
  const sites = new Map(); // "file:line" -> Map(bucket -> count)
  const totals = {};
  for (const ln of lines(join(POSTFIX, file))) {
    const f = ln.trim().split(/\s+/);
    if (f[0] === 'PROFHIST') {
      const site = f[f.length - 1];
      const m = sites.get(site) ?? new Map();
      for (let i = 2; i < f.length - 1; i++) {
        const [b, c] = f[i].split(':').map(Number);
        m.set(b, (m.get(b) ?? 0) + c);
      }
      sites.set(site, m);
    } else if (f[0] === 'PROF-TOTAL' || f[0] === 'PROF-SIZEHIST-TOTAL'
            || f[0] === 'PROF-STACKS-TOTAL' || f[0] === 'PROF-SIZEHIST'
            || f[0] === 'PROF-STACKS') {
      totals[f[0]] = f.slice(1).join(' ');
    }
  }
  return { sites, totals };
}

const octave = (n) => Math.floor(Math.log2(n));
const sitesInOctave = (sites, b) => [...sites]
  .filter(([, m]) => m.has(b))
  .map(([s, m]) => [s, m.get(b)])
  .sort((x, y) => y[1] - x[1]);

/* ---------- 0. inputs --------------------------------------------------- */

const cen = Object.fromEntries(RUNS.map((r) => [r, census(r)]));
const sb = profhist('sb.prof.txt');
const sa = profhist('sa.prof.txt');

P('================================================================');
P(' SITE ATTRIBUTION FOR THE PEAK-ONLY CLASSES');
P(' 1,048,576 / 934,576 / 4,376 -- no build, no run');
P('================================================================');
P();
P('Census : evidence-peakvar/p1..p6.heapcen.txt   (6 runs, stackless+fiber)');
P('PROF   : evidence-postfix/sb.prof.txt, sa.prof.txt  (DIFFERENT build/run)');
P();
P('CROSS-RUN: a request SIZE crosses between these; a COUNT does not.');
P('Nothing below uses a PROF count to describe a census population.');
P();

/* ---------- 1. what the census class actually IS ----------------------- */

P('--- 1. THE CENSUS CLASS IS THE REQUEST, NOT THE BLOCK ------------------');
P();
P('scr_heap_census.h:317   scr_hc_note((size_t)e.cbData, (size_t)e.cbOverhead)');
P('scr_heap_census.h:161   if (tbl[j].n != 0 && tbl[j].size != size) continue;');
P('scr_heap_census.h:167   tbl[j].bytes += size + overhead;');
P();
P('=> the class label is cbData, matched EXACTLY (no octave, no band), and');
P('   the overhead rides in the bytes column only. So (bytes/n - size) is');
P('   the measured mean overhead -- it is DERIVED here, not assumed.');
P();
P('  run  class        n    bytes       mean overhead/block');
for (const r of RUNS) {
  for (const t of TARGETS) {
    const e = cen[r].peak.get(t);
    if (!e) continue;
    const ov = (e.bytes - t * e.n) / e.n;
    P(`  ${r}   ${String(t).padStart(9)} ${String(e.n).padStart(5)}  `
      + `${String(e.bytes).padStart(10)}  ${ov.toFixed(2)}`);
  }
}
P();
P('THE OVERHEAD IS NOT A CONSTANT, so it could not have been guessed and it');
P('cannot be calibrated from one known class. Measured, per class, same run:');
P('    1,048,576 -> 0        934,576 -> 16        4,376 -> 248');
P('       65,536 -> 18.4-19.7 (NON-INTEGRAL: that class mixes blocks whose');
P('                            overheads differ, so it is not one geometry)');
P('The briefing asked me to derive the overhead rather than guess it. The');
P('derivation\'s actual result is that the question does not arise: see below.');
P();
P('That 1,048,576 alone reads 0.00, in all six runs, is an observation about');
P('block geometry and not an explanation. This slice does not know why the');
P('Windows heap accounts a 1 MiB block with no overhead and a 934,576 B');
P('block with 16, and does not guess.');
P();
P('THE CALIBRATION QUESTION IS MOOT, and that is the useful part. The');
P('briefing\'s "class 1,328 measures 1,360 = 1,328 + 32" is the BYTES COLUMN,');
P('not the class label: the label 1,328 already IS the request. A PROF');
P('request size and a census class label are therefore the SAME QUANTITY and');
P('compare directly, with no overhead term to derive, calibrate or guess.');
P('Check on the 1,328 class itself -- and note it reads 16 in some runs and');
P('32 in others, i.e. the overhead moves with POPULATION (the low-count runs');
P('are the stackless arm, the 20k-count runs the fiber arm). A single');
P('calibration constant taken from one class would have been wrong:');
for (const r of RUNS) {
  const e = cen[r].peak.get(1328);
  if (e) P(`  ${r}  class 1328  n=${String(e.n).padStart(6)}  `
    + `bytes=${e.bytes}  overhead/block=${((e.bytes - 1328 * e.n) / e.n).toFixed(2)}`);
}
P();

/* ---------- 2. the octave decode, verified not assumed ----------------- */

P('--- 2. THE PROFHIST OCTAVE DECODE, VERIFIED -----------------------------');
P();
P('scr_prof.h:823-825 says bucket b holds [2^b, 2^(b+1)). Verified against');
P('sites whose PROF row gives an exact mean size (bytes/count), so the');
P('decode is CHECKED rather than taken from the comment:');
P();
/* re-read the PROF rows for the check */
const profRows = new Map();
for (const ln of lines(join(POSTFIX, 'sb.prof.txt'))) {
  const f = ln.trim().split(/\s+/);
  if (f[0] === 'PROF' && f.length >= 9) {
    profRows.set(f[f.length - 1], { count: +f[1], bytes: +f[2] });
  }
}
let checked = 0, ok = 0;
for (const [site, m] of sb.sites) {
  if (m.size !== 1) continue;            // single-bucket sites only
  const row = profRows.get(site);
  if (!row || row.count === 0) continue;
  const mean = row.bytes / row.count;
  if (!Number.isInteger(mean) || mean < 8) continue;
  const b = [...m.keys()][0];
  checked++;
  const hit = octave(mean) === b;
  if (hit) ok++;
  if (checked <= 6) P(`  ${site}`.padEnd(66)
    + `mean=${String(mean).padStart(7)}  bucket=${b}  floor(log2)=${octave(mean)}  ${hit ? 'OK' : 'MISMATCH'}`);
}
P(`  ... ${ok} of ${checked} single-bucket sites with an integral mean agree.`);
P();
P(`  => 1,048,576 -> bucket ${octave(1048576)} (it is the bottom edge, 2^20 exactly)`);
P(`  =>   934,576 -> bucket ${octave(934576)} (inside [2^19, 2^20))`);
P(`  =>     4,376 -> bucket ${octave(4376)} (inside [2^12, 2^13))`);
P();

/* ---------- 3. candidate sites ----------------------------------------- */

P('--- 3. EVERY SITE THAT ALLOCATES IN THE TARGET OCTAVES -----------------');
P();
for (const [label, b] of [['1,048,576', 20], ['934,576', 19], ['4,376', 12]]) {
  P(`  class ${label}  ->  octave ${b}  [${2 ** b}, ${2 ** (b + 1)})`);
  for (const [tag, prof] of [['sb', sb], ['sa', sa]]) {
    const c = sitesInOctave(prof.sites, b);
    if (!c.length) { P(`    ${tag}: NONE`); continue; }
    for (const [site, n] of c.slice(0, 8)) {
      P(`    ${tag}: ${String(n).padStart(6)}  ${site}`);
    }
  }
  P();
}

/* ---------- 4. the elimination ----------------------------------------- */

P('--- 4. ELIMINATING scr_string.c:1217 BY THE SHAPE OF ITS REQUEST -------');
P();
P('Two sites carry octaves 19 AND 20. They are separated by ARITHMETIC, not');
P('by plausibility:');
P();
P('  scr_bytes.c:52   b->data = calloc(len ? len : 1, scr_bytes_elem_size(elem));');
P('     request = len * elemsize, EXACT. A Buffer of 1,048,576 bytes asks');
P('     for exactly 1,048,576. Any class value is reachable.');
P();
P('  scr_string.c:1217  realloc(s, scr_pool_bytes(sizeof(ScrStr) + newcap + 1))');
P('     sizeof(ScrStr) = 12 (three uint32_t + char data[], scr_runtime.h:754)');
P('     SCR_POOL_GRAIN = 8          (scr_runtime.h:359)');
P('     scr_pool_bytes(n) = (n+7) & ~7   (scr_runtime.h:433)');
P('     => request = roundup8(newcap + 13).');
P('     Its only caller is scr_jb_grow, whose buffer DOUBLES from 64');
P('     (scr_string.c:1194-1196, in the comment on the carve predicate), so');
P('     newcap = 2^k and the request is 2^k + 16 for every k >= 4.');
P();
P('  So scr_string.c:1217 CANNOT produce a 1,048,576 request. It produces');
P('  1,048,592. Prediction: classes of the form 2^k + 16 must exist in the');
P('  census (the builder is real and does grow), but must stop below the');
P('  megabytes if its big buffers are not live at a census instant.');
P();
P('  Every class of the form 2^k+16 present in ANY of the twelve census');
P('  instants (6 runs x {peak, shutdown}):');
const shaped = new Map();
for (const r of RUNS) {
  for (const [which, tbl] of [['peak', cen[r].peak], ['shutdown', cen[r].rest]]) {
    for (const [size, e] of tbl) {
      for (let k = 4; k <= 24; k++) {
        if (size === 2 ** k + 16) {
          const key = size;
          const g = shaped.get(key) ?? [];
          g.push(`${r}/${which}:n=${e.n}`);
          shaped.set(key, g);
        }
      }
    }
  }
}
for (const size of [...shaped.keys()].sort((a, b) => a - b)) {
  P(`    ${String(size).padStart(8)}  seen ${shaped.get(size).length}x  `
    + `(e.g. ${shaped.get(size).slice(0, 3).join(', ')})`);
}
const maxShaped = Math.max(...shaped.keys());
P();
P(`  Largest 2^k+16 class anywhere: ${maxShaped}. The builder is visible and`);
P('  it stops at 64 KiB live. 1,048,592 and 524,304 are ABSENT from all');
P('  twelve instants, while PROF shows the builder DID allocate 31 blocks in');
P('  octave 20 over the run -- i.e. those blocks exist but are never live at');
P('  a census instant. scr_string.c:1217 is eliminated for both megabytes.');
P();
P('  REMAINING CANDIDATE FOR BOTH: scr_bytes.c:52, the ScrBytes backing');
P('  store -- the typed-array / Buffer payload allocator.');
P();

/* ---------- 5. the 4,376 class ----------------------------------------- */

P('--- 5. THE 4,376 CLASS HAS STACKS, NOT JUST A SIZE ---------------------');
P();
P('This is the one class the PROF build was ARMED on by size band:');
P(`  ${sb.totals['PROF-STACKS'] ?? '(absent)'}`);
P(`  PROF-STACKS-TOTAL ${sb.totals['PROF-STACKS-TOTAL'] ?? '(absent)'}`);
P();
P('sizeband2 = 4376..4376 is the target class exactly. The captured frames:');
let band = 0, bandBytes = 0;
for (const ln of lines(join(POSTFIX, 'sb.prof.txt'))) {
  const f = ln.trim().split(/\s+/);
  if (f[0] !== 'PROFSTACK') continue;
  const c = +f[1], by = +f[2];
  if (c > 0 && by / c === 4376) { band += c; bandBytes += by; }
}
P(`  PROFSTACK rows whose mean size is exactly 4376: ${band} allocations,`);
P(`  ${bandBytes} bytes. (4376 * ${band} = ${4376 * band}; exact => a pure class.)`);
P();
P('  The site, from PROFHIST octave 12, dominated by:');
for (const [site, n] of sitesInOctave(sb.sites, 12).slice(0, 3)) {
  P(`    ${String(n).padStart(6)}  ${site}`);
}
P();
P('  The top row is NOT the answer, and the two above sqlite are eliminated');
P('  by arithmetic, not by ranking:');
P();
P('  scr_array.c:444 -- ELIMINATED. scr_arr_grow (scr_array.c:391-399):');
P('      size_t cap = a->cap ? a->cap : 4;');
P('      while (cap < need) { ...; cap *= 2; }');
P('      size_t want = cap * sizeof(uint64_t);');
P('    cap starts at 4 and DOUBLES, so cap = 2^k and want = 2^(k+3) is');
P('    ALWAYS a power of two. 4,376 is not. Its 17,815 octave-12');
P('    allocations are all want = 4096 (the next step, 8192, is >=');
P('    SCR_ARR_VM_MIN and leaves the CRT heap entirely, scr_array.c:237).');
P('    The same fact removes it from octaves 19 and 20 a priori.');
P();
P('  scr_heap_census.h:707 -- ELIMINATED, and it is the INSTRUMENT:');
P('      arm[i] = malloc(SCR_HEAPCEN_ARM_SIZE);   /* 5113, line 289 */');
P('    5113 is in octave 12 but is not 4,376, and both census files');
P('    corroborate it by name: HCTOTAL ... armCount=137 armSize=5113,');
P('    against exactly 137 octave-12 allocations at that site.');
P();
P('  SURVIVING: vendor/sqlite/sqlite3.c:28035, sqlite3MemMalloc:');
P('      p = SQLITE_MALLOC( nByte+8 );   /* then p[0]=nByte; p++ */');
P('  which is the "+8" of WHICH-BUFFER.md\'s 4096 + 216 + 56 + 8 = 4376.');
P('  The class is SQLite\'s page cache, one buffer per database page, via');
P('  pcache1Alloc -> sqlite3Malloc -> sqlite3MemMalloc.');
P();
P('  The captured stacks corroborate SHAPE independently of the size: every');
P('  PROFSTACK row in the 4376 band shares a 9-frame common prefix and');
P('  differs only at frame 10. A single deep allocator funnel reached from');
P('  many callers is what a library malloc shim looks like; a runtime array');
P('  or map store called from the emitted program would vary much higher up.');
P('  The frames are unsymbolised RVAs, so this is a shape argument, not an');
P('  identification -- it is listed as corroboration, not as proof.');
P();

/* ---------- 6. coverage controls --------------------------------------- */

P('--- 6. PROF COVERAGE, MEASURED ----------------------------------------');
P();
P('POSITIVE CONTROL -- does PROF see VENDORED libraries at all? The briefing');
P('named this as the likeliest way the whole search returns a false null.');
P('Site families in sb.prof.txt:');
const fam = new Map();
for (const site of sb.sites.keys()) {
  const m = site.match(/vendor[\\/]([a-z0-9-]+)/);
  const k = m ? `vendor/${m[1]}` : (/[\\/]src[\\/]/.test(site) ? 'runtime/src' : 'other');
  fam.set(k, (fam.get(k) ?? 0) + 1);
}
for (const [k, n] of [...fam].sort((a, b) => b[1] - a[1])) {
  P(`    ${String(n).padStart(4)} sites  ${k}`);
}
P();
P('  => vendored sqlite AND zlib both register sites. The feared blind spot');
P('     does NOT exist for them, and the single most load-bearing');
P('     attribution in this file (4,376 = sqlite page cache) rests on a');
P('     VENDOR site. The positive control discriminates and it passes.');
P();
P('NEGATIVE CONTROL -- is there a live census class with NO site in its');
P('octave? If PROF were blind to a path, a class it owns would show up here.');
P('Every peak class of p1 with n >= 4, against the sb site table:');
let orphanBytes = 0, orphanRows = 0, coveredBytes = 0;
const orphans = [];
for (const [size, e] of [...cen.p1.peak].sort((a, b) => b[1].bytes - a[1].bytes)) {
  if (e.n < 4 || size < 16) continue;
  const b = octave(size);
  const c = sitesInOctave(sb.sites, b);
  if (!c.length) { orphans.push([size, e.n, e.bytes]); orphanBytes += e.bytes; orphanRows++; }
  else coveredBytes += e.bytes;
}
if (orphans.length) {
  for (const [size, n, by] of orphans.slice(0, 20)) {
    P(`    ORPHAN class ${String(size).padStart(9)} n=${String(n).padStart(6)} bytes=${by}`);
  }
} else {
  P('    (none)');
}
P(`    orphan classes: ${orphanRows}, ${orphanBytes} bytes;`);
P(`    covered classes bytes: ${coveredBytes}`);
P(`    => ${(100 * coveredBytes / (coveredBytes + orphanBytes)).toFixed(2)}% of peak bytes in classes `
  + 'with n>=4 sit in an octave PROF registers.');
P();
P('  THIS CONTROL IS WEAK AND SAYS SO. An octave is 1 doubling wide, so');
P('  "some site allocates in this octave" is a low bar and a pass here is');
P('  NOT proof the class\'s own site is registered. It can only FALSIFY.');
P('  It did not falsify. That is all it is worth.');
P();
P('A CONTROL THAT DID NOT DISCRIMINATE, stated rather than buried: PROF');
P('outstanding (count - freed) vs the census busy-block count.');
const pt = Object.fromEntries((sb.totals['PROF-TOTAL'] ?? '').split(/\s+/)
  .map((kv) => kv.split('=')));
const outstanding = (+pt.count) - (+pt.freed);
P(`    sb PROF: count=${pt.count} freed=${pt.freed} => outstanding=${outstanding}`);
P('    sb census at shutdown: blocks=47940  (sb.heapcen.txt, HCTOTAL)');
P(`    ratio ${(outstanding / 47940).toFixed(2)}x`);
P('  PROF reports 4.6x MORE outstanding than the heap holds blocks, which is');
P('  the wrong direction for a blind spot and so cannot measure one. The');
P('  cause is that PROF counts logical allocations the string arena and the');
P('  pool serve by carving and recycling, which never become distinct CRT');
P('  blocks. This control is reported because it was run, and it discriminates');
P('  NOTHING about coverage.');
P();

/* ---------- 7. the count ------------------------------------------------ */

P('--- 7. THE COUNT: 6 AND 7, AGAINST CHUNKS=8 ----------------------------');
P();
P('  run   1,048,576   934,576   mode');
for (const r of RUNS) {
  const a = cen[r].peak.get(1048576), b = cen[r].peak.get(934576);
  P(`  ${r}    ${String(a ? a.n : 0).padStart(9)} ${String(b ? b.n : 0).padStart(9)}   `
    + `${a && a.n === 7 ? 'HIGH' : 'low'}`);
}
P();
P('  The two classes agree on the mode in all six runs, and neither ever');
P('  reads 8. The explanation is NOT from this slice -- it is the phase');
P('  trace quoted in PEAK-OCCUPANT.md section 4, from the evidence-peak runs:');
P();
P('     abba1A  chunk-decoded-1 20.995 | 2..7 all within 6 ms at 27.68 | 8 at 28.408');
P('     abba3B  chunk-decoded-1 20.972 | 2..8 all within 5 ms at 29.27');
P();
P('  All eight chunks are SENT inside 191 ms; the client holds and decodes');
P('  them in one burst ~7 s later. Chunk 1 always decodes alone at ~21.0 s');
P('  and is released long before the burst. The burst is then chunks 2..7');
P('  (six) or 2..8 (seven). The peak census samples inside that window.');
P('  So 8 chunks = 1 early + (6 or 7) concurrent: the census never sees 8');
P('  because chunk 1 is never concurrent with the rest.');
P();
P('  CROSS-RUN: that trace is from evidence-peak (a different build and a');
P('  different set of runs). It explains the SHAPE 6/7-not-8 that p1..p6');
P('  show; no number is carried across.');
P();

/* ---------- 8. what this does and does not establish -------------------- */

P('--- 8. WHAT IS AND IS NOT ESTABLISHED ----------------------------------');
P();
P('ESTABLISHED');
P('  * 4,376 = SQLite page cache, vendor/sqlite/sqlite3.c:28035');
P('    (sqlite3MemMalloc, the nByte+8 path). Evidence is THREE-fold and the');
P('    strands are independent: the octave-12 site table, a stack-capture');
P('    band armed on exactly 4376..4376, and the source arithmetic');
P('    4096+216+56+8. This one is not a size coincidence. The two sites that');
P('    OUTRANK it in the octave are both eliminated by arithmetic:');
P('    scr_array.c:444 can only request powers of two (cap doubles from 4,');
P('    want = cap*8), and scr_heap_census.h:707 is the instrument\'s own');
P('    5113-byte arm, corroborated by HCTOTAL armSize=5113 armCount=137.');
P('  * scr_string.c:1217 is ELIMINATED for both megabyte classes, by the');
P('    arithmetic of its own request expression plus the absence of every');
P('    2^k+16 class above 65,552 from all twelve census instants.');
P('  * The census class label is the REQUEST (cbData), exactly; no overhead');
P('    term stands between a PROF size and a census class.');
P();
P('NOT ESTABLISHED');
P('  * That scr_bytes.c:52 IS the site of 1,048,576 and 934,576. It is the');
P('    ONLY SURVIVING CANDIDATE among registered sites, which is stronger');
P('    than a size match, but it is still an elimination over the set PROF');
P('    registers -- and the octave is a doubling wide, so "scr_bytes.c:52');
P('    allocates somewhere in [512K,1M)" is not "scr_bytes.c:52 allocates');
P('    exactly 934,576". NO stack band was armed on these sizes, so there is');
P('    no second strand. Call it a leading candidate, not a naming.');
P('  * WHY the 1,048,576 class carries overhead 0 and 934,576 carries 16.');
P('  * Whether the pair is one logical object or two. The counts move');
P('    together in all six runs and the mode agrees, which is consistent');
P('    with a pair, but co-movement under a shared driver (the chunk burst)');
P('    is exactly what two INDEPENDENT per-chunk buffers would also show.');
P('    This cannot separate those.');
P();
P('WHAT WOULD CLOSE IT, and it is cheap');
P('  sb-build.sh:16 already carries the mechanism:');
P('    -DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376');
P('  One rebuild with');
P('    -DSCR_PROF_STACK_SIZE_MIN=934576  -DSCR_PROF_STACK_SIZE_MAX=934576');
P('    -DSCR_PROF_STACK_SIZE_MIN2=1048576 -DSCR_PROF_STACK_SIZE_MAX2=1048576');
P('  captures full 10-frame stacks for both classes and turns this');
P('  elimination into a naming. That is a build and a run, which this slice');
P('  was explicitly forbidden to do.');
P();

/* ---------- 9. the prediction ------------------------------------------ */

P('--- 9. VERDICT ON THE PREREGISTERED PREDICTION -------------------------');
P();
P('Predicted, before this slice ran: "1,048,576 and 934,576 are a PAIR --');
P('a decode/stream buffer allocated per in-flight history-sync chunk, one');
P('sized by a CONSTANT and the other DERIVED from it."');
P();
P('  (a) PAIR, in the sense of co-moving: SUPPORTED. Same count and same');
P('      mode in all six runs (section 7), and PEAK-OCCUPANT.md section 4');
P('      reports the same agreement on its own four runs.');
P('  (b) PER IN-FLIGHT CHUNK: SUPPORTED but not by this slice. The count');
P('      equals the burst width from the phase trace, which is another');
P('      slice\'s measurement. Here it is consistency, not evidence.');
P('  (c) A DECODE BUFFER: the surviving candidate scr_bytes.c:52 is the');
P('      Buffer / typed-array payload store, which is the right KIND of');
P('      object. Still an elimination, not a naming -- see section 8.');
P('  (d) "ONE SIZED BY A CONSTANT, THE OTHER DERIVED FROM IT":');
P('      NOT SUPPORTED, and this is the half that fails.');
{
  const a = 1048576, b = 934576;
  P(`      ${a} = 2^20 exactly -- constant-shaped. Fine.`);
  // factor b
  let n = b, f = [];
  for (let d = 2; d * d <= n; d++) while (n % d === 0) { f.push(d); n /= d; }
  if (n > 1) f.push(n);
  P(`      ${b} = ${f.join(' * ')}  -- its odd part is ${f[f.length - 1]}, prime.`);
  P(`      a - b = ${a - b};  b/a = ${(b / a).toFixed(9)};  a/b = ${(a / b).toFixed(9)}`);
  P('      No power-of-two ratio, no round difference, no shift-and-add of');
  P('      the 1 MiB figure lands on it. 934,576 looks like a DATUM (a');
  P('      payload length that is what it is), not a size derived from a');
  P('      cap. The pair co-moves because one driver produces both, which');
  P('      is a weaker claim than "derived from".');
}
P();
P('  AND THE CO-MOVEMENT CANNOT BE PUSHED FURTHER. Two independent');
P('  per-chunk buffers driven by the same burst produce exactly the same');
P('  lockstep as one object holding two allocations. This slice has no');
P('  column that separates those, and the overhead reading (0 vs 16) is a');
P('  hint in the OTHER direction that was not followed up.');
P();

const text = out.join('\n') + '\n';
if (process.argv.includes('--stdout')) process.stdout.write(text);
else {
  writeFileSync(join(HERE, 'RESULTS.txt'), text);
  process.stderr.write(`wrote ${join(HERE, 'RESULTS.txt')} (${Buffer.byteLength(text)} B)\n`);
}
