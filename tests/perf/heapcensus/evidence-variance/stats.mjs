/* stats.mjs -- the whole analysis of evidence-variance, re-runnable FROM THIS
 * DIRECTORY with no arguments:   node stats.mjs
 *
 * DIR defaults to this script's own directory, which holds the six committed
 * <tag>.heapcen.txt. The 38 KB-per-run <tag>.prof.txt are NOT committed, so
 * the arena chunk counts fall back to the committed chunkrows.txt, which
 * carries the identical PROF lines. Point DIR at a live memrig output root to
 * re-run against fresh runs:
 *   node stats.mjs /g/blocks/v1-run
 *
 * EVERY ANCHOR BELOW TOLERATES A TRAILING CR. The .heapcen.txt files are
 * CRLF -- the instrumented binary writes them through a Windows text-mode
 * FILE -- and a bare $ silently matches nothing against them. That is not
 * hypothetical: it ate the PROF extraction while building chunkrows.txt.
 *
 * census-arms.sh:132 is a committed recipe that cannot run. This one was
 * executed from the committed tree, with no arguments, before being
 * committed, and its output diffed byte-for-byte against RESULTS.txt. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2] ? resolve(process.argv[2]) : HERE
const CR = join(HERE, 'chunkrows.txt')
const CHUNKROWS = existsSync(CR) ? readFileSync(CR, 'latin1') : ''
const ORDER = [['a1','A',1],['b1','B',2],['b2','B',3],['a2','A',4],['a3','A',5],['b3','B',6]]
const rows = []
for (const [tag, arm, pos] of ORDER) {
  const t = readFileSync(join(DIR, tag + '.heapcen.txt'), 'latin1')
  const m = t.match(/^\[heapcen\] heap 0 \S+ CRT busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+) regions=(\d+)\r?$/m)
  const tot = t.match(/^\[heapcen\] HCTOTAL distinctSizes=\d+ blocks=(\d+) bytes=(\d+) lost=(\d+)/m)
  const profPath = join(DIR, tag + '.prof.txt')
  const p = existsSync(profPath)
    ? readFileSync(profPath, 'latin1')
    : CHUNKROWS.split(/\r?\n/)
        .filter(l => l.trim().startsWith(tag + '  PROF '))
        .map(l => l.trim().slice(tag.length + 2))
        .join('\n')
  const pm = p.match(/^PROF (\d+) (\d+) (\d+) (\d+) (\d+) \S+ \d+ .*scr_string\.c:820\r?$/m)
  const hc = t.match(/^HCSIZE 131079 (\d+) (\d+)\r?$/m)
  rows.push({ tag, arm, pos, busy:+m[1], busyBlk:+m[2], free:+m[3], freeBlk:+m[4], unc:+m[5], reg:+m[6],
    committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],
    hcBlocks:+tot[1], hcBytes:+tot[2], hcLost:+tot[3],
    chunks: pm?+pm[1]:null, chunkB: pm?+pm[2]:null, chunkFreed: pm?+pm[3]:null, row131079: hc?+hc[1]:0 })
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))}
const TCRIT={1:12.706,2:4.303,3:3.182,4:2.776}
const tcrit=df=>TCRIT[Math.max(1,Math.min(4,Math.floor(df)))]
function welch(A,B){
  const mA=mean(A),mB=mean(B),sA=sd(A),sB=sd(B),nA=A.length,nB=B.length
  const se=Math.sqrt(sA*sA/nA+sB*sB/nB), d=mB-mA
  const df=(sA*sA/nA+sB*sB/nB)**2/(((sA*sA/nA)**2)/(nA-1)+((sB*sB/nB)**2)/(nB-1))
  const tc=tcrit(df)
  return {mA,mB,sA,sB,se,d,t:se?Math.abs(d)/se:Infinity,df,tc,lo:d-tc*se,hi:d+tc*se}
}
const L=[]
const say=s=>{L.push(s);console.log(s)}

say('=== V1 RESULTS -- PRE vs POST string-arena repair, 3 runs each, alternated ===')
say('tree        /g/blocks/v1-wt @ ff33bac69, branch perf/heapcen-committed-variance')
say('A = PRE  /g/blocks/h2-out182-prof/zapo-rest-182.exe   (the exe evidence-idle/on.manifest.txt names)')
say('B = POST /g/blocks/sb-out182-prof/zapo-rest-182.exe   (the exe evidence-postfix/sb.manifest.txt names)')
say('knobs     CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000')
say('          PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1')
say('          -- term for term the knobs of BOTH committed manifests.')
say('recipe    /g/blocks/v1-run.sh + /g/blocks/v1-rig.sh, derived from')
say('          evidence-postfix/sb-run.sh and sb-rig.sh. Nothing was built.')
say('order     A B B A A B, declared in PREREG.txt before run 1 existed.')
say('')
say('=== PARSE CONTROLS (a parse that cannot fail cannot be trusted) ===')
for(const r of rows){
  const ok = r.hcBytes===r.busy && r.hcBlocks===r.busyBlk && r.hcLost===0
  say(`  ${r.tag}  HCTOTAL bytes == heap-0 busy, blocks == busyBlocks, lost == 0 : ${ok?'OK':'MISMATCH'}`)
}
say('')
say('  POSITIVE CONTROL for the arm-A chunk count. The PRE binary carries NO')
say('  profiled chunk site: evidence-postfix/sa.c1.txt shows body scr_prof_malloc')
say('  = 0 for the pre-fix scr_str_chunk_alloc, and strings(1) on the PRE exe')
say('  finds no "scr_string.c:820". So an ABSENT PROF line on arm A proves')
say('  nothing at all, and a zero there would be a dead counter, not a finding.')
say('  Arm A is read instead off the HCSIZE 131079 row -- the _aligned_malloc')
say('  request 65536 + 65535 + 8 -- which reads NON-ZERO in all three A runs:')
for(const r of rows) say(`    ${r.tag} ${r.arm}  HCSIZE-131079 blocks = ${String(r.row131079).padStart(2)}   PROF :820 chunks = ${r.chunks===null?'(site absent in this binary -- expected)':r.chunks}`)
say('  And the mirror control holds: HCSIZE 131079 is ABSENT in all three B')
say(`  runs (${rows.filter(r=>r.arm==='B').map(r=>r.row131079).join(', ')}), which is the repair, seen directly.`)

say('')
say('=== EVERY RUN, in the declared ABBAAB order ===')
say('pos tag arm        busy  busyBlk        free  freeBlk   committed  uncommitted  busy+free+unc  reg  chunks   chunkB  freed')
for(const r of rows) say([String(r.pos).padStart(3),r.tag.padEnd(3),r.arm,
  String(r.busy).padStart(11),String(r.busyBlk).padStart(8),String(r.free).padStart(11),
  String(r.freeBlk).padStart(8),String(r.committed).padStart(11),String(r.unc).padStart(12),
  String(r.addrspace).padStart(14),String(r.reg).padStart(4),
  String(r.chunks??'-').padStart(7),String(r.chunkB??'-').padStart(8),String(r.chunkFreed??'-').padStart(6)].join(' '))

const COLS=['busy','free','committed','unc','addrspace','busyBlk','freeBlk']
function table(title, filt){
  say(''); say(title)
  say('column        A mean      A sd      B mean      B sd        delta B-A     |t|    df   t_crit        95% CI on the delta    sig?')
  const o={}
  for(const c of COLS){
    const A=rows.filter(r=>r.arm==='A'&&filt(r)).map(r=>r[c])
    const B=rows.filter(r=>r.arm==='B'&&filt(r)).map(r=>r[c])
    const w=welch(A,B); o[c]=w
    say([c.padEnd(10),w.mA.toFixed(0).padStart(11),w.sA.toFixed(0).padStart(9),
      w.mB.toFixed(0).padStart(11),w.sB.toFixed(0).padStart(9),w.d.toFixed(0).padStart(15),
      w.t.toFixed(2).padStart(8),w.df.toFixed(2).padStart(6),w.tc.toFixed(3).padStart(7),
      `[${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}]`.padStart(28),
      (w.t>w.tc?'YES':'no').padStart(5)].join(' '))
  }
  return o
}
const all = table('=== ALL SIX RUNS. Welch t, with the CRITICAL VALUE TAKEN AT THE WELCH df ===', ()=>true)
say('  NOTE ON THE CRITICAL VALUE. The variances are wildly unequal (arm B')
say('  carries ~12x arm A\'s sd on free/committed/uncommitted), so the Welch df')
say('  collapses to ~2 and the right two-sided 95% bar is 4.303, NOT the 2.776')
say('  of df=4. Reading this table at df=4 flips the committed verdict.')
const lo1 = table('=== LEAVE-ONE-OUT: position 1 (a1) dropped, as the pre-registration promised ===', r=>r.tag!=='a1')

say('')
say('=== WITHIN-ARM SPREAD, against the 2,330,464 B committed delta the brief asked about ===')
for(const arm of ['A','B']) for(const c of ['busy','free','committed','unc','addrspace']){
  const a=rows.filter(r=>r.arm===arm).map(r=>r[c])
  say(`  arm ${arm}  ${c.padEnd(10)} range = ${String(Math.max(...a)-Math.min(...a)).padStart(8)} B   sd = ${sd(a).toFixed(0).padStart(8)} B`)
}
const Bcom=rows.filter(r=>r.arm==='B').map(r=>r.committed)
say('')
say(`  THE ONE-LINE ANSWER TO THE BRIEF. Arm B's own committed range, across`)
say(`  three back-to-back runs of ONE binary at fixed knobs, is ${Math.max(...Bcom)-Math.min(...Bcom)} B.`)
say(`  The brief's cross-day pair reports a committed delta of 2,330,464 B as a`)
say(`  finding. The noise on a single arm is LARGER than the effect being read.`)

say('')
say('=== THE BRIEFS TWO COMMITTED ROWS, PLACED AGAINST THIS SLICE ===')
const PRE={busy:18907440,free:17493520,unc:29888512,busyBlk:47624,freeBlk:14968,tag:'evidence-idle/on'}
const POST={busy:15902592,free:22828832,unc:27570176,busyBlk:47940,freeBlk:13644,tag:'evidence-postfix/sb'}
for(const o of [PRE,POST]){o.committed=o.busy+o.free;o.addrspace=o.busy+o.free+o.unc}
for(const c of ['busy','busyBlk','freeBlk','free','committed','unc','addrspace']){
  const A=rows.filter(r=>r.arm==='A').map(r=>r[c]),B=rows.filter(r=>r.arm==='B').map(r=>r[c])
  say(`  ${c.padEnd(10)} on = ${String(PRE[c]).padStart(11)}  z vs this A = ${((PRE[c]-mean(A))/sd(A)).toFixed(2).padStart(7)}` +
      `   |  sb = ${String(POST[c]).padStart(11)}  z vs this B = ${((POST[c]-mean(B))/sd(B)).toFixed(2).padStart(7)}`)
}
const dPair=POST.committed-PRE.committed
say('')
say(`  the brief's committed delta (one cross-day pair) = ${dPair} B = +${(dPair/1048576).toFixed(3)} MiB`)
const w=all.committed
say(`  this slice's committed delta (3 v 3)             = ${w.d.toFixed(0)} B = ${(w.d/1048576).toFixed(3)} MiB`)
say(`  |t| = ${w.t.toFixed(2)}, Welch df = ${w.df.toFixed(2)}, t_crit = ${w.tc.toFixed(3)}  =>  ${w.t>w.tc?'SEPARABLE':'NOT SEPARABLE FROM ZERO'}`)
say(`  95% CI = [${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}] B`)
say(`     contains 0 ?                      ${w.lo<=0&&0<=w.hi?'YES':'NO'}`)
say(`     contains the brief's +${dPair} ?  ${w.lo<=dPair&&dPair<=w.hi?'YES':'NO'}`)
say(`  THE POINT ESTIMATE HAS THE OPPOSITE SIGN TO THE BRIEF'S PAIR, and neither`)
say(`  sign is supported: the interval spans both.`)

say('')
say('=== POWER OF THE COMMITTED NULL, n=3 per arm ===')
function phi(z){return 0.5*(1+erf(z/Math.SQRT2))}
function erf(x){const s=Math.sign(x);x=Math.abs(x);const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;const t=1/(1+p*x);return s*(1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x))}
const sp=Math.sqrt((w.sA**2+w.sB**2)/2), se=sp*Math.sqrt(2/3), tc=w.tc
say(`  pooled sd = ${sp.toFixed(0)} B;  se of the difference = ${se.toFixed(0)} B;  t_crit(df=${w.df.toFixed(2)}) = ${tc.toFixed(3)}`)
for(const eff of [2330464,3014656,3080192,5000000,8000000]){
  const ncp=eff/se, pw=1-(phi(tc-ncp)-phi(-tc-ncp))
  say(`  power to detect a TRUE committed shift of ${String(eff).padStart(8)} B  =  ${(pw*100).toFixed(1)}%`)
}
say(`  MINIMUM DETECTABLE EFFECT at 80% power = ${(se*(tc+0.842)).toFixed(0)} B = ${(se*(tc+0.842)/1048576).toFixed(2)} MiB`)
say(`  runs per arm needed to bring the MDE down to the brief's 2,330,464 B,`)
say(`  holding this slice's pooled sd (equal-variance t, df = 2(n-1)):`)
let found=false
for(let n=3;n<=200;n++){
  const se2=sp*Math.sqrt(2/n), df=2*(n-1), tc2=df>=4?2.776:tcrit(df)
  const mde=se2*(tc2+0.842)
  if(mde<=2330464){say(`    n = ${n} per arm  (MDE ${mde.toFixed(0)} B)`);found=true;break}
}
if(!found)say('    more than 200 per arm')
say(`  At 2.33 min per run (measured: this slice's six manifests) that is`)
say(`  2 x 10 x 2.33 = 46.6 min of wall clock to put the brief's 2.33 MB on or`)
say(`  off the table. This slice spent 14.0 min and can only exclude > 5.72 MiB.`)

say('')
say('=== WHERE THE RELEASED BYTES WENT: the conservation identity, measured ===')
say(`  delta busy        = ${all.busy.d.toFixed(0)} B   (|t| = ${all.busy.t.toFixed(1)}, t_crit ${all.busy.tc.toFixed(3)})`)
say(`  delta free        = ${all.free.d.toFixed(0)} B   (|t| = ${all.free.t.toFixed(2)}, t_crit ${all.free.tc.toFixed(3)})`)
say(`  delta uncommitted = ${all.unc.d.toFixed(0)} B   (|t| = ${all.unc.t.toFixed(2)}, t_crit ${all.unc.tc.toFixed(3)})`)
say(`  delta busy+free+uncommitted = ${all.addrspace.d.toFixed(0)} B  (|t| = ${all.addrspace.t.toFixed(2)}, t_crit ${all.addrspace.tc.toFixed(3)}) => ${all.addrspace.t>all.addrspace.tc?'SEPARABLE':'NOT SEPARABLE FROM ZERO'}`)
say(`  arithmetic check: ${all.busy.d.toFixed(0)} + ${all.free.d.toFixed(0)} + ${all.unc.d.toFixed(0)} = ${(all.busy.d+all.free.d+all.unc.d).toFixed(0)}, and the addrspace column reports ${all.addrspace.d.toFixed(0)}`)
say('')
say('  READ THIS COLUMN AND NOT THE OTHERS. Heap 0 holds the SAME total extent')
say('  in both arms -- busy + free + uncommitted differs by 74,784 B out of')
say('  66.0 MB and is not separable from zero. The 3.02 MB the repair takes out')
say('  of busy therefore does not leave heap 0 at all; it is redistributed')
say('  between free and uncommitted, and WHICH of the two it lands in is the')
say('  noisy quantity (arm B sd ~2.0 MB on each, perfectly anti-correlated).')
say('  That is the mechanism behind the brief\'s 2.33 MB, and it is why no')
say('  single pair can read it.')
say('')
say('  THE ANTI-CORRELATION, shown rather than asserted. free + uncommitted,')
say('  per run, in the order they ran:')
for(const r of rows) say(`    ${r.tag} ${r.arm}  free ${String(r.free).padStart(11)} + unc ${String(r.unc).padStart(11)} = ${r.free+r.unc}`)
say('')
say('  AND THE CORRELATION MUST BE TAKEN WITHIN AN ARM, NOT ACROSS BOTH. Over')
say('  all six runs free+uncommitted differs between the arms BY CONSTRUCTION --')
say('  busy differs by 3.02 MB and the three columns sum to a near-constant --')
say('  so a pooled r measures the repair, not the jitter. Per arm:')
for(const arm of ['A','B']){
  const v=rows.filter(r=>r.arm===arm)
  const f=v.map(r=>r.free), u=v.map(r=>r.unc), s=v.map(r=>r.free+r.unc)
  say(`    arm ${arm}:  free range ${String(Math.max(...f)-Math.min(...f)).padStart(8)} B` +
      `   uncommitted range ${String(Math.max(...u)-Math.min(...u)).padStart(8)} B` +
      `   SUM range ${String(Math.max(...s)-Math.min(...s)).padStart(8)} B`)
}
say('    (n=3 per arm, so a Pearson r on three points is not quoted; the range')
say('     of the SUM against the range of the PART is the statement that survives.)')
say('  Arm B is the clean case: free swings 3,804,048 B across three runs of one')
say('  binary and uncommitted absorbs it, leaving the sum inside 43,792 B. Arm A')
say('  compensates only partly -- its sum still moves 294,112 B -- so the')
say('  near-perfect offset is a property of arm B here, not a law.')

say('')
say('=== THE ARENA ITSELF: a correction to the record falls out ===')
const Bc=rows.filter(r=>r.arm==='B')
say(`  arm B chunk count, three runs: ${Bc.map(r=>r.chunks).join(', ')}   (chunk frees: ${Bc.map(r=>r.chunkFreed).join(', ')})`)
say(`  arm A chunk count via HCSIZE 131079, three runs: ${rows.filter(r=>r.arm==='A').map(r=>r.row131079).join(', ')}`)
say(`  committed evidence-idle/on    HCSIZE 131079 blocks = 46`)
say(`  committed evidence-postfix/sa PROF :820 chunks     = 47  (FIBER lane)`)
say(`  committed evidence-postfix/sb PROF :820 chunks     = 47  (STACKLESS lane)`)
say(`  => 46 in 6 of 8 observations; 47 in 2 of 8, both of them the 2026-10-11`)
say(`     post-fix pair. The chunk population is NOT a constant; it varies by`)
say(`     one 64 KiB chunk run to run on a fixed binary and fixed knobs.`)
const mB=mean(Bc.map(r=>r.busy)), mA=mean(rows.filter(r=>r.arm==='A').map(r=>r.busy))
const mAl=mean(rows.filter(r=>r.arm==='A'&&r.tag!=='a1').map(r=>r.busy))
say(`  realized release at 46 chunks = 46 x 65536 = ${46*65536} B`)
say(`  measured busy delta, all six    = ${(mA-mB).toFixed(0)} B  (residual vs 46x65536: ${((mA-mB)-46*65536).toFixed(0)} B)`)
say(`  measured busy delta, a1 dropped = ${(mAl-mB).toFixed(0)} B  (residual vs 46x65536: ${((mAl-mB)-46*65536).toFixed(0)} B)`)
say(`  ROUTE B share, this slice: ${46*65536} / ${mA.toFixed(0)} = ${(46*65536/mA*100).toFixed(3)}%`)
say(`     [denominator = mean heap-0 busy of this slice's THREE PRE runs]`)
say(`  ROUTE A share, this slice: ${46*65536} / ${(mB+46*65536).toFixed(0)} = ${(46*65536/(mB+46*65536)*100).toFixed(3)}%`)
say(`     [denominator = mean heap-0 busy of this slice's THREE POST runs + the release]`)
say(`  The committed record raised this headline from 15.940% to 16.226% on the`)
say(`  strength of sb's 47 chunks. At 46 -- the modal count, 6 of 8 -- it reads`)
say(`  ~15.94% again. The raise rests on a single draw of a quantity that moves.`)

if (process.env.V1_WRITE) writeFileSync(process.env.V1_WRITE, L.join('\n') + '\n')

/* RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY
 *
 * THE LINE THIS BAND ANSWERS, at :42 (and the same expression at :138):
 *
 *     committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],
 *
 * The field this script calls `committed` is busy + free.
 * `addrspace` on the same line is correctly named and is NOT affected.
 *
 * `busy + free` is heap ADDRESS SPACE, not committed memory. The NT heap
 * decommits pages inside a free run without emitting a
 * PROCESS_HEAP_UNCOMMITTED_RANGE, so HeapWalk keeps reporting the whole block
 * and the `free` column mixes committed pages with pages already returned to
 * the OS. Demonstrated with a negative control (an arm that frees nothing
 * reads 100% MEM_COMMIT; three arms that free read 74.6% / 93.7% / 92.7%
 * MEM_RESERVE), and contradicted arithmetically in one run: an outside walk
 * resolves 21.312 MiB of private non-stack commit while this process's own
 * HeapWalk reports busy+free = 37.245 MiB.
 *
 * `busy` is unaffected -- it is live data. `uncommitted` is unaffected -- it
 * is reserved and not paid. The SUM is still a valid CEILING. Only its
 * reading as COMMIT is retracted.
 *
 * Full argument, negative control and inventory:
 * tests/perf/heapcensus/COMMITTED-FREE-RETRACTION.md
 *
 * This band audits ONE figure. EVERYTHING ELSE IN THIS FILE IS UNAUDITED BY
 * IT -- not thereby in force. */
