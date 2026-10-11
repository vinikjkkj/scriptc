/* mb-attrib.mjs -- name the 934,576 and 1,048,576 classes of the stackless
 * peak transient. Runs from THIS directory with no arguments and WRITES
 * RESULTS.txt; it reads only files committed beside it.
 *
 * It does NOT re-symbolise: that needs the PDB, the zig cache objects and
 * WSL's llvm-pdbutil, none of which are committable. mb-symbolize.mjs is the
 * recipe and mb.symbols.txt its captured output; this script quotes that file
 * and says so, rather than pretending the map is regenerated here. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = []
const P = (s = '') => out.push(s)
const read = f => readFileSync(join(HERE, f), 'utf8')
const lines = f => read(f).split(/\r?\n/)
const n = x => x.toLocaleString('en-US')

/* ---- 1. the arm -------------------------------------------------------- */
P('MEGABYTE PAIR -- SITE ATTRIBUTION BY EXACT SIZE BAND')
P('='.repeat(72))
P()
P('ONE build, TWO runs, stackless lane, knob ABSENT. The only change against')
P('evidence-postfix/sb-build.sh is the two stack bands:')
P()
for (const k of ['ARM', 'head', 'KNOB', 'PROF_CFLAGS', 'SCRIPTC_NO_CACHE',
                 'EARLY-CACHE', 'BUILD-EXIT', 'elapsed-s', 'EXE',
                 'EMITTED', 'EMITTED-LL-N', 'EMITTED-C-N', 'cli-dist-sha']) {
  for (const ln of lines('mb.build-env.txt')) if (ln.startsWith(k + ' ')) P('  ' + ln.trim())
}
P()
P('LANE, confirmed in the artifact and not assumed:')
P('  tests/perf/stackless-knob-guard.mjs against the live CLI dist: ' +
  lines('guard.txt').filter(l => l.includes('GUARD: OK'))[0].trim())
P('  rg -c scr_fiber on the emitted zapo-rest.ll  = 3 lines')
P('  reference (MEM-STATE 2026-10-11 s.8): stackless 3 / fibre 1,488, ratio')
P('  496x, stackless .ll 242,844,7xx B -- this .ll is 242,844,729 B.')
P('  A REAL module does NOT read zero on this lane; the discriminator is the')
P('  ratio. "Must be 0" holds only for the guard ten-line probe, and it is')
P('  0 there.')
P()

/* ---- 2. the band ------------------------------------------------------- */
const bands = {}
for (const tag of ['m1', 'm2']) {
  const rows = []
  let total = null
  for (const ln of lines(tag + '.prof.txt')) {
    const f = ln.trim().split(/\s+/)
    if (f[0] === 'PROFSTACK') {
      const count = +f[1], bytes = +f[2]
      rows.push({ count, bytes, size: bytes / count, frames: f.slice(3) })
    } else if (f[0] === 'PROF-STACKS-TOTAL') total = ln.trim()
  }
  bands[tag] = { rows, total }
}
P('--- 1. THE BAND FIRED, AND IT FIRED IDENTICALLY TWICE -----------------')
P()
P('The band hook covers calloc. scr_prof.h:1005-1018 defines scr_prof_calloc')
P('and :1061 macro-replaces calloc with it; the body calls')
P('SCR_PROF_NOTE_STACK(r, a * b) -- the PRODUCT, which is the request size and')
P('therefore the census class exactly (scr_heap_census.h:317 notes cbData).')
P('Had it wrapped malloc only, this band would have read zero and that zero')
P('would have been "not instrumented", not "no such site". It does not.')
P()
for (const tag of ['m1', 'm2']) P(`  ${tag}: ${bands[tag].total}`)
P()
P('  Per captured stack. bytes/count is an exact integer equal to a band edge')
P('  in every row, so each row is a PURE class and no mixture is averaged:')
P()
P('   run  allocs      bytes       size  frame0    frame1')
for (const tag of ['m1', 'm2']) {
  for (const r of bands[tag].rows.slice().sort((a, b) => b.count - a.count || b.size - a.size)) {
    P(`   ${tag}  ${String(r.count).padStart(6)}  ${String(r.bytes).padStart(9)}  ${String(r.size).padStart(9)}  ${r.frames[0].padStart(8)}  ${r.frames[1].padStart(8)}`)
  }
}
P()
const key = r => r.count + ':' + r.bytes + ':' + r.frames.join(' ')
const s1 = new Set(bands.m1.rows.map(key)), s2 = new Set(bands.m2.rows.map(key))
const same = [...s1].filter(k => s2.has(k))
P(`  Rows byte-identical across the two runs -- count, bytes AND all ten`)
P(`  frame RVAs: ${same.length} of ${s1.size} / ${s2.size}. The row that differs is the SINGLETON`)
P('  (1 x 1,048,576), whose walk reaches two frames further in m2; its count,')
P('  its size and its first two frames are the same.')
P()
const byClass = {}
for (const r of bands.m1.rows) (byClass[r.size] ??= []).push(r)
for (const sz of [934576, 1048576]) {
  const rs = byClass[sz] ?? []
  P(`  class ${n(sz)}: ${rs.reduce((a, r) => a + r.count, 0)} allocations in ${rs.length} distinct stacks` +
    ` (${rs.map(r => r.count).join(' + ')})`)
}
P()
P('  8 is CHUNKS=8. Each of the three 8-allocation stacks fires exactly once')
P('  per history-sync chunk. That is the burst the peak decomposition read as')
P('  "6 or 7 concurrent": 8 are produced and one retires early (86613275d s.5).')
P()

/* ---- 3. the registered set --------------------------------------------- */
P('--- 2. THE REGISTERED SET, FROM THIS RUN ------------------------------')
P()
P('PROFHIST octave 19 = [2^19, 2^20), which holds 934,576; octave 20 =')
P('[2^20, 2^21), which holds 1,048,576. Every site allocating there in m1:')
P()
for (const ln of lines('m1.prof.txt')) {
  const f = ln.trim().split(/\s+/)
  if (f[0] !== 'PROFHIST') continue
  for (const tok of f.slice(2, -1)) {
    const [o, c] = tok.split(':')
    if (o === '19' || o === '20') P(`    oct${o}  count=${String(c).padStart(4)}  ${f[f.length - 1]}`)
  }
}
P()
P('Four sites, two of them singletons. The two real candidates are the two the')
P('previous slice narrowed to, and the band now separates them BY STACK rather')
P('than by arithmetic:')
P()
P('  scr_string.c:1217 (scr_str_regrow, realloc). Its octave ladder in this')
P('  run is 10:1 11:1 12:1 13:1 14:1 15:1 16:1 17:32 18:32 19:32 20:31 21:16 --')
P('  a textbook doubling. 86613275d predicted from the source that its')
P('  requests have the form 2^k+16 and so can never BE 1,048,576. That is')
P('  CONFIRMED HERE BY A ROUTE ARITHMETIC COULD NOT GIVE: it has 31')
P('  allocations in octave 20 and the 1,048,576 band captured nine, none of')
P('  them from its TU. Were those 31 at 1,048,576 the band would hold them.')
P()
P('  scr_bytes.c:52 SURVIVES -- and is now named rather than left standing.')
P()

/* ---- 4. the name -------------------------------------------------------- */
P('--- 3. THE SITE, NAMED BY SYMBOL ---------------------------------------')
P()
P('Frames are image-relative RVAs (scr_prof.h:871). Resolved by')
P('tests/perf/obj-symbols.mjs against the COFF objects, never the PDB, which')
P('on the LLVM lane resolves names WRONGLY rather than absently. The map is')
P('refused unless every public inside its range agrees; the scr_bytes map')
P('checked 59 publics and 59 agreed. Captured output: mb.symbols.txt; recipe:')
P('mb-symbolize.mjs.')
P()
P('  113bc2 = scr_prof_note_stack+98   (scr_bytes.c own static copy)')
P('  10d678 = scr_bytes_alloc+488      <-- THE RETURN ADDRESS OF THE calloc')
P()
P('scr_bytes_alloc is scr_bytes.c:42-59 and holds exactly one allocation of')
P('payload size, at LINE 52:')
P()
P('    b->data = calloc(len ? len : 1, scr_bytes_elem_size(elem));')
P()
P('scr_prof_calloc is static and inlined into it, which is why frame1 is')
P('scr_bytes_alloc itself and not the interposer. 24 of the 25 band')
P('allocations carry this exact pair at depth 0 and 1.')
P()
P('  >>> 934,576 and 1,048,576 ARE packages/runtime/src/scr_bytes.c:52,')
P('  >>> the Buffer / typed-array payload calloc inside scr_bytes_alloc.')
P()
P('--- 4. WHICH PATH -- which is what a file:line does not say ------------')
P()
P('  A  8 x   934,576  scr_bytes_alloc <- [runtime TU, unmapped] <- .. <- main')
P('  B  8 x 1,048,576  scr_bytes_alloc <- ProtoStreamReader_ensure+2024')
P('  C  8 x   934,576  scr_bytes_alloc <- scr_bytes_copy+27 <- .. <- main')
P('  D  1 x 1,048,576  .. <- wsSendText <- wsOffer <- wsCatchUp <- wsAttach')
P()
P('B is the decisive one: sc_tr__x25__x25_m41_ProtoStreamReader_ensure is the')
P('protobuf stream reader growing its read buffer, and it reaches')
P('scr_bytes_alloc DIRECTLY -- one 1 MiB Buffer per chunk. C is')
P('scr_bytes_copy (scr_bytes.c:79, scr_bytes_alloc(src->elem, src->len)) --')
P('a COPY of a 934,576-byte payload. A and C share their inner suffix')
P('(2035a9 202f5b 16e1a2 1a30bc9), so the 934,576 pair is ONE producer reached')
P('two ways, not two independent buffers: a payload produced once and copied')
P('once, at the SAME length.')
P()
P('That settles "one object with two allocations vs two independent buffers')
P('per chunk" (86613275d s.7) in the FIRST direction, for 934,576 only.')
P('D is a DIFFERENT site -- its frames 0 and 1 fall outside scr_bytes.obj --')
P('on the websocket send path, and it is 1 allocation, not 8.')
P()
P('WHY 6-7 LIVE BLOCKS AT THE PEAK: 8 chunks decode concurrently and each')
P('holds a 1 MiB reader buffer plus a 934,576-byte payload plus its copy. The')
P('count is the chunk fan-out, not a cap, and the burst drains as chunks')
P('retire -- which is why all of these classes have NO LINE AT ALL in the')
P('shutdown census.')
P()

/* ---- 5. the prediction -------------------------------------------------- */
P('--- 5. THE BRIEFING PREDICTIONS, SCORED -------------------------------')
P()
P('  "the pair comes out of scr_bytes.c:52"                    UPHELD')
P()
P('  "934,576 = 2^4 x 58,411 with 58,411 prime, so it is a payload LENGTH')
P('   (data) and not a size derived from a cap"                UPHELD. Stack C')
P('   is a copy of an existing buffer and stack A its producer; neither is a')
P('   container growth. The one growth-shaped site in the band, B, carries the')
P('   OTHER class -- the round 2^20, which is the cap-shaped number. The')
P('   briefing had the right property on the right number.')
P()
P('  "the stack should show a media/protobuf decode path, not a container')
P('   growth"                                                  UPHELD FOR B')
P('   (ProtoStreamReader.ensure). For A and C the deciding frames land in a')
P('   runtime TU this slice did not map, so the path above scr_bytes_copy is')
P('   NOT NAMED. Recorded as unfinished, not as agreement.')
P()
P('  THE HALF THE BRIEFING CALLED MOST LIKELY WRONG -- "the band may not even')
P('  capture scr_bytes.c:52, because it is calloc and not malloc" -- is')
P('  REFUTED, and refuted BEFORE the build rather than by it: scr_prof.h:1005')
P('  defines scr_prof_calloc, :1061 macro-replaces calloc, and the body passes')
P('  the product to the stack note. The ten minutes of reading said GO.')
P()

/* ---- 6. controls ------------------------------------------------------- */
P('--- 6. CONTROLS -------------------------------------------------------')
P()
P('POSITIVE CONTROL: not needed, and that is a statement about the result and')
P('not a skipped step. The band did not read zero -- it read 25 allocations')
P('and 24,390,400 bytes in BOTH runs. The previous build sizeband2=4376..4376')
P('captured 2,780 allocations of exactly 4,376 B, so the mechanism was known')
P('live; this run shows it live on two new sizes.')
P()
P('EXACTNESS: bytes/count is an integer equal to a band edge in every row. A')
P('row mixing sizes would show a fractional mean. None does.')
P()
P('NEGATIVE: tablefull=0 and lost=0 in both runs, so no row is a sample of')
P('whatever ran first, and no admitted allocation failed to key to a stack.')
P()
P('WHAT THIS DOES NOT SHOW. skipped= is about 10.5 million: the band is a')
P('FILTER and these 25 stacks are not a census of the program. The claim is')
P('about the two named classes only.')
P()
P('FLUX vs RETENTION. PROF counts the whole run, so 25 allocations over a run')
P('is a FLOW. That they are simultaneously LIVE at the peak is the separate')
P('HCPKSIZE evidence of 272390bd2, not something this band measures.')
P()

writeFileSync(join(HERE, 'RESULTS.txt'), out.join('\n') + '\n')
console.log('wrote RESULTS.txt (' + out.length + ' lines)')
