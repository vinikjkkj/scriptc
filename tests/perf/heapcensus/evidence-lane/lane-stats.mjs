/* lane-stats.mjs -- the whole analysis of evidence-lane, re-runnable FROM THIS
 * DIRECTORY with no arguments:   node lane-stats.mjs
 *
 * It is evidence-variance/stats.mjs EXTENDED, not rewritten: the parse, the
 * Welch block, the t_crit-at-the-Welch-df rule and the power block are that
 * file's, carried over. What is new is the arm pair (FIBER vs STACKLESS
 * instead of PRE vs POST), the cross-session block, and the fourteen-
 * observation chunk tally.
 *
 * DIR defaults to this script's own directory. The six <tag>.heapcen.txt are
 * committed; the 38 KB-per-run <tag>.prof.txt are not, so chunk counts fall
 * back to the committed chunkrows.txt carrying the identical PROF lines.
 * Point DIR at a live memrig output root to re-run against fresh runs:
 *   node lane-stats.mjs /g/blocks/v2-run
 *
 * EVERY ANCHOR TOLERATES A TRAILING CR. The .heapcen.txt are CRLF -- the
 * instrumented binary writes them through a Windows text-mode FILE. Every
 * file in this directory written BY HAND is LF, verified with a byte counter
 * and not with rg: rg -c for a bare CR reports a match on every line of a
 * pure-LF file, a fabricated positive that confirms the rule under audit.
 *
 * This script was executed from the committed tree, with no arguments,
 * before being committed, and its output is RESULTS.txt verbatim. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2] ? resolve(process.argv[2]) : HERE
const V1 = join(HERE, '..', 'evidence-variance')
const CR = join(HERE, 'chunkrows.txt')
const CHUNKROWS = existsSync(CR) ? readFileSync(CR, 'latin1') : ''

const HEAP0 = /^\[heapcen\] heap 0 \S+ CRT busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+) regions=(\d+)\r?$/m
const HCTOT = /^\[heapcen\] HCTOTAL distinctSizes=\d+ blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const PROF820 = /^PROF (\d+) (\d+) (\d+) (\d+) (\d+) (\S+) \d+ .*scr_string\.c:820\r?$/m
const HC131079 = /^HCSIZE 131079 (\d+) (\d+)\r?$/m

function read(dir, tag, arm, pos) {
  const t = readFileSync(join(dir, tag + '.heapcen.txt'), 'latin1')
  const m = t.match(HEAP0), tot = t.match(HCTOT), hc = t.match(HC131079)
  const profPath = join(dir, tag + '.prof.txt')
  const p = existsSync(profPath)
    ? readFileSync(profPath, 'latin1')
    : CHUNKROWS.split(/\r?\n/).filter(l => l.trim().startsWith(tag + '  PROF '))
        .map(l => l.trim().slice(tag.length + 2)).join('\n')
  const pm = p.match(PROF820)
  return { tag, arm, pos, busy:+m[1], busyBlk:+m[2], free:+m[3], freeBlk:+m[4], unc:+m[5], reg:+m[6],
    committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],
    hcBlocks:+tot[1], hcBytes:+tot[2], hcLost:+tot[3],
    chunks: pm?+pm[1]:null, chunkB: pm?+pm[2]:null, chunkFreed: pm?+pm[3]:null,
    siteId: pm?pm[6]:null, row131079: hc?+hc[1]:0 }
}
/* THE DECLARED ORDER, from PREREG.txt, written before run 1 existed. */
const ORDER = [['c1','C',1],['b1','B',2],['b2','B',3],['c2','C',4],['c3','C',5],['b3','B',6]]
const rows = ORDER.map(([tag, arm, pos]) => read(DIR, tag, arm, pos))
/* The PREVIOUS session's three runs of the SAME sb binary at the SAME knobs. */
const v1b = ['b1','b2','b3'].map(tag => read(V1, tag, 'B', 0))

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

say('=== V2 RESULTS -- THE LANE, FIBER vs STACKLESS, 3 runs each, alternated ===')
say('tree        /g/blocks/v2-wt @ dc0d063c1, branch perf/heapcen-lane-variance')
say('C = FIBER      /g/blocks/sa2-out182-prof/zapo-rest-182.exe  (exe 32,679,424 B)')
say('B = STACKLESS  /g/blocks/sb-out182-prof/zapo-rest-182.exe   (exe 33,356,800 B)')
say('BOTH ARE POST-REPAIR. The PRE binary is not used: this slice isolates the')
say('lane, not the repair.')
say('knobs     CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000')
say('          PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1')
say('          -- diffed term for term against evidence-variance/v1-run.sh: identical.')
say('recipe    ./v2-run.sh + ./v2-rig.sh, IN THIS DIRECTORY, sourced from here and')
say('          executed exactly as committed. Nothing was built.')
say('order     C B B C C B, declared in PREREG.txt before run 1 existed.')
say('cost      14.2 min wall for six runs (08:43:17Z -> 08:57:29Z), 2.37 min/run.')
say('')
say('THE CLAIM UNDER AUDIT, carried by three committed documents:')
say('  "busy 16,243,072 (FIBER, sa) vs 15,902,592 (STACKLESS, sb) = -340,480 B"')
say('It rests on ONE run per arm. This slice gives each arm three.')

say('')
say('=== CONTROLS (a control that cannot fail is not a control) ===')
for(const r of rows){
  const ok = r.hcBytes===r.busy && r.hcBlocks===r.busyBlk && r.hcLost===0
  say(`  ${r.tag}  parse: HCTOTAL bytes == heap-0 busy, blocks == busyBlocks, lost == 0 : ${ok?'OK':'MISMATCH'}`)
}
say('')
say('  LANE IDENTITY. Not an exe hash -- a lane property, read off the .ll before')
say('  run 1:   sa2 = 1488 lines matching scr_fiber,   sb = 3 lines.  Ratio 496x.')
say('  BOTH READ NON-ZERO, and that is the control working. Stackless conversion')
say('  is per-function, so a real module keeps a declare and two calls on the')
say('  stackless lane. The discriminator is the RATIO; a zero here would be a')
say('  dead grep, not a cleaner lane. (The "must be 0" criterion belongs only to')
say('  the ten-line probe in tests/perf/stackless-knob-guard.mjs.)')
say('')
say('  SITE-ID CONTROL, per run, independent of the manifest. The PROF row carries')
say("  the binary's own site id for scr_string.c:820; it must partition by arm:")
for(const r of rows) say(`    ${r.tag} ${r.arm}  site ${r.siteId}`)
const idC=[...new Set(rows.filter(r=>r.arm==='C').map(r=>r.siteId))]
const idB=[...new Set(rows.filter(r=>r.arm==='B').map(r=>r.siteId))]
say(`    arm C: ${idC.join(',')}   arm B: ${idB.join(',')}   partitions cleanly: ${idC.length===1&&idB.length===1&&idC[0]!==idB[0]?'YES':'NO'}`)
say('')
say('  POSITIVE CONTROL for the chunk counter: PROF :820 reads NON-ZERO in all six')
say(`  runs (${rows.map(r=>r.chunks).join(', ')}), on both lanes. The counter is alive in both arms.`)
say('')
say('  AND A NULL THAT PROVES NOTHING IN THIS SLICE, SAID OUT LOUD. HCSIZE 131079')
say('  -- the pre-repair _aligned_malloc request of 65536+65535+8 -- is ABSENT in')
say(`  all six runs (${rows.map(r=>r.row131079).join(', ')}). BOTH arms here are post-repair, so this slice`)
say('  contains NO arm that could make that row read non-zero. On its own it')
say('  cannot tell "repaired" from "dead row". Its positive arm lives in the')
say('  previous slice: evidence-variance arm A reads 46, 46, 46 on exactly this')
say('  row. Read it there, not here.')

say('')
say('=== EVERY RUN, in the declared CBBCCB order ===')
say('pos tag arm lane            busy  busyBlk        free  freeBlk   committed  uncommitted  busy+free+unc  reg  chunks   chunkB  freed')
for(const r of rows) say([String(r.pos).padStart(3),r.tag.padEnd(3),r.arm,
  (r.arm==='C'?'FIBER    ':'STACKLESS'),
  String(r.busy).padStart(11),String(r.busyBlk).padStart(8),String(r.free).padStart(11),
  String(r.freeBlk).padStart(8),String(r.committed).padStart(11),String(r.unc).padStart(12),
  String(r.addrspace).padStart(14),String(r.reg).padStart(4),
  String(r.chunks??'-').padStart(7),String(r.chunkB??'-').padStart(8),String(r.chunkFreed??'-').padStart(6)].join(' '))

const COLS=['busy','free','committed','unc','addrspace','busyBlk','freeBlk','reg']
say('')
say("=== >>> EACH ARM'S SPREAD, BEFORE ANY t. THIS IS THE RESULT. <<< ===")
say("  The brief named arm C's variance as the half of the design most likely to")
say('  break it, and required the sd of each arm before any t statistic.')
say('')
say('column       arm C range    arm C sd   arm B range    arm B sd   C sd / B sd')
for(const c of COLS){
  const A=rows.filter(r=>r.arm==='C').map(r=>r[c]), B=rows.filter(r=>r.arm==='B').map(r=>r[c])
  const sA=sd(A), sB=sd(B)
  say([c.padEnd(10),String(Math.max(...A)-Math.min(...A)).padStart(12),sA.toFixed(0).padStart(11),
    String(Math.max(...B)-Math.min(...B)).padStart(12),sB.toFixed(0).padStart(11),
    (sB?(sA/sB).toFixed(1):'inf').padStart(12)].join(' '))
}
const sdCbusy=sd(rows.filter(r=>r.arm==='C').map(r=>r.busy))
const sdBbusy=sd(rows.filter(r=>r.arm==='B').map(r=>r.busy))
say('')
say('  THE ONE NUMBER THIS SLICE EXISTS TO PRODUCE: the FIBER arm busy sd is')
say(`  ${sdCbusy.toFixed(0)} B. The previous slice's STACKLESS busy sd was 762 B, which made`)
say('  the 340,480 B claim look like a 447x margin over the noise. Against')
say(`  ${sdCbusy.toFixed(0)} B the same claim is ${(340480/sdCbusy).toFixed(2)}x the arm's own sd.`)
say(`  This session's STACKLESS busy sd is ${sdBbusy.toFixed(0)} B, itself ${(sdBbusy/762).toFixed(0)}x the previous`)
say('  session\'s 762 B -- so the tight arm was a property of that session too.')

function table(title, filt){
  say(''); say(title)
  say('column        C mean      C sd      B mean      B sd        delta B-C     |t|    df   t_crit        95% CI on the delta    sig?')
  const o={}
  for(const c of COLS){
    const A=rows.filter(r=>r.arm==='C'&&filt(r)).map(r=>r[c])
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
const all = table('=== ALL SIX RUNS. Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===', ()=>true)
say('  SIGN CONVENTION: delta = B - C = STACKLESS minus FIBER, the same direction')
say('  as the audited sentence, which reports -340,480 B.')
say('  The Welch df collapses toward 2 when the variances are unequal, and the')
say('  two-sided 95% bar there is 4.303, NOT the 2.776 of df=4. Reading the')
say('  previous slice at df=4 flipped a verdict; the df used is printed per row.')
say('')
say('  >>> AND A FLOOR THAT APPLIES TO EVERY "YES" IN THAT TABLE. <<<')
say('  At 3 v 3 there are C(6,3) = 20 arm assignments, so the smallest attainable')
say('  TWO-SIDED permutation p is 2/20 = 0.10. No effect, however large, can')
say('  reach p < 0.05 at this n without leaning on the normal assumption. Every')
say('  YES above is therefore parametric, and the four that appear -- free,')
say('  committed, busyBlk, freeBlk -- all clear 4.303 only narrowly (|t| 4.7-5.9)')
say('  and ALL of them revert to "no" under the pre-registered leave-one-out.')
say('  Read them as "worth n=7", not as established.')
const lo1 = table('=== LEAVE-ONE-OUT: position 1 (c1) dropped, as PREREG.txt promised ===', r=>r.tag!=='c1')
say('  Promised before run 1 and reported whether or not it helps. With n=2 on')
say('  arm C the df falls further and the bar rises, so it cannot rescue busy;')
say(`  busy there reads |t| = ${lo1.busy.t.toFixed(2)} against t_crit ${lo1.busy.tc.toFixed(3)} => ${lo1.busy.t>lo1.busy.tc?'SEPARABLE':'NOT SEPARABLE'}.`)

say('')
say('=== >>> THE VERDICT ON THE -340,480 B SENTENCE <<< ===')
const w=all.busy
const CLAIM=-340480
say(`  claimed, from one cross-day pair (sb - sa):   ${CLAIM} B`)
say(`  measured here, 3 v 3 (B - C):                 ${w.d.toFixed(0)} B`)
say(`  arm C busy sd ${w.sA.toFixed(0)} B,  arm B busy sd ${w.sB.toFixed(0)} B,  se of the delta ${w.se.toFixed(0)} B`)
say(`  |t| = ${w.t.toFixed(2)}, Welch df = ${w.df.toFixed(2)}, t_crit = ${w.tc.toFixed(3)}  =>  ${w.t>w.tc?'SEPARABLE':'NOT SEPARABLE FROM ZERO'}`)
say(`  95% CI on the lane's busy delta = [${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}] B`)
say(`     contains 0 ?                      ${w.lo<=0&&0<=w.hi?'YES':'NO'}`)
say(`     contains the claimed ${CLAIM} ?   ${w.lo<=CLAIM&&CLAIM<=w.hi?'YES':'NO'}`)
say('')
say('  THE INTERVAL CONTAINS BOTH ZERO AND THE CLAIM. This slice does NOT refute')
say('  a -340 KB lane effect; it shows the committed pair never had the power to')
say('  assert one. The statement that survives is NOT SEPARABLE AT n=3, and the')
say('  sentence must be marked as such in the three documents that carry it.')
say('')
say('  AND THE INTRA-ARM RANGE SETTLES IT WITHOUT ANY t AT ALL: arm C busy swings')
const Cb=rows.filter(r=>r.arm==='C').map(r=>r.busy)
say(`  ${(Math.max(...Cb)-Math.min(...Cb))} B across three runs of ONE binary at fixed knobs. The effect being`)
say(`  read off a single pair is ${340480} B -- ${(340480/(Math.max(...Cb)-Math.min(...Cb))).toFixed(2)}x the noise on one arm. A pair cannot`)
say('  carry an effect smaller than the within-arm range.')

say('')
say("=== THE COMMITTED PAIR, PLACED AGAINST THIS SESSION'S ARMS ===")
const SA={busy:16243072,busyBlk:47719,free:31132528,unc:51982336,reg:11,freeBlk:null,tag:'sa'}
const SB={busy:15902592,busyBlk:47940,free:22828832,unc:27570176,reg:9,freeBlk:null,tag:'sb'}
for(const o of [SA,SB]){o.committed=o.busy+o.free;o.addrspace=o.busy+o.free+o.unc}
const Cv=rows.filter(r=>r.arm==='C'), Bv=rows.filter(r=>r.arm==='B')
say('  column        sa (FIBER)   z vs this C  |     sb (STACKLESS)   z vs this B')
for(const c of ['busy','busyBlk','free','committed','unc','addrspace','reg']){
  const A=Cv.map(r=>r[c]), B=Bv.map(r=>r[c])
  const zA=sd(A)?((SA[c]-mean(A))/sd(A)).toFixed(2):'n/a', zB=sd(B)?((SB[c]-mean(B))/sd(B)).toFixed(2):'n/a'
  say(`  ${c.padEnd(10)} ${String(SA[c]).padStart(12)} ${String(zA).padStart(13)}  |  ${String(SB[c]).padStart(12)} ${String(zB).padStart(13)}`)
}
const zsb=((SB.busy-mean(Bv.map(r=>r.busy)))/sd(Bv.map(r=>r.busy))).toFixed(2)
const zsbB=((SB.busyBlk-mean(Bv.map(r=>r.busyBlk)))/sd(Bv.map(r=>r.busyBlk))).toFixed(2)
say('')
say('  THE "sb IS AN OUTLIER" FINDING SPLITS IN TWO, and only half of it was an')
say('  artefact. a0e2c9fa3 named both halves and diagnosed neither.')
say('')
say(`  ON busy IT WAS AN ARTEFACT OF THE DENOMINATOR. sb read z = +13.49 against`)
say(`  the previous session's stackless arm; against THIS session's stackless arm`)
say(`  -- same binary, same knobs -- it reads z = ${zsb}. An outlier score is a`)
say('  statement about the ARM it is scored against, and that arm changed between')
say('  sessions: its busy sd was 762 B then and 37,880 B now. sb was never an')
say('  outlying RUN on busy; the previous trio was an unusually tight ARM.')
say('')
say(`  ON busyBlocks IT IS REAL AND STILL UNEXPLAINED. sb's 47,940 reads z = ${zsbB}`)
say('  against this session, worse than the +150.52 it read against the last one.')
say('  Both z values are inflated by tiny denominators (sd 2 B then, 1 B now) and')
say('  neither should be quoted as a z at all -- but the RAW number stands on its')
const sbPeers=[...v1b,...Bv].map(r=>r.busyBlk)
say(`  own. The ${sbPeers.length} measured runs of this exact binary (3 last session, 3 this one)`)
say(`  read busyBlocks ${sbPeers.join(', ')} -- a span of ${Math.max(...sbPeers)-Math.min(...sbPeers)} blocks. sb itself`)
say(`  sits at ${SB.busyBlk}, ${SB.busyBlk-Math.max(...sbPeers)} blocks above the top of that span, with nothing`)
say('  in between. THIS SLICE DOES NOT EXPLAIN IT.')
say('  It is named as an open item, not retired, and it is NOT the quantity the')
say('  -340,480 B sentence was about.')

say('')
say('=== THE FREE THIRD DATUM: BETWEEN-SESSION DRIFT OF ONE FIXED BINARY ===')
say('  Same exe (sb, 33,356,800 B), same ten knobs, same host, different session.')
say('  Previous session: evidence-variance b1/b2/b3. This session: b1/b2/b3 here.')
say('  Nobody had measured this term; it is reported whichever way it falls.')
say('  column        prev mean   prev sd    this mean   this sd       drift     |t|    df  t_crit   sig?')
for(const c of ['busy','busyBlk','free','committed','unc','addrspace']){
  const P=v1b.map(r=>r[c]), N=Bv.map(r=>r[c])
  const w2=welch(P,N)
  say([c.padEnd(10),w2.mA.toFixed(0).padStart(12),w2.sA.toFixed(0).padStart(9),
    w2.mB.toFixed(0).padStart(12),w2.sB.toFixed(0).padStart(9),w2.d.toFixed(0).padStart(11),
    w2.t.toFixed(2).padStart(8),w2.df.toFixed(2).padStart(6),w2.tc.toFixed(3).padStart(7),
    (w2.t>w2.tc?'YES':'no').padStart(5)].join(' '))
}
const dsess=welch(v1b.map(r=>r.busy),Bv.map(r=>r.busy))
say('')
say(`  busy drifts ${dsess.d.toFixed(0)} B between sessions on a FIXED binary. That is`)
say(`  ${(Math.abs(dsess.d)/340480*100).toFixed(1)}% of the lane effect the committed pair claims to have measured`)
say('  ACROSS sessions, which is why the previous slice\'s b-runs were NOT reused')
say('  as this slice\'s arm: session is exactly the term a reuse cannot hold fixed.')

say('')
say('=== POWER, n=3 per arm, against the claim ===')
function phi(z){return 0.5*(1+erf(z/Math.SQRT2))}
function erf(x){const s=Math.sign(x);x=Math.abs(x);const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;const t=1/(1+p*x);return s*(1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x))}
const sp=Math.sqrt((w.sA**2+w.sB**2)/2), se=sp*Math.sqrt(2/3), tc=w.tc
say(`  busy: pooled sd = ${sp.toFixed(0)} B;  se of the difference = ${se.toFixed(0)} B;  t_crit(df=${w.df.toFixed(2)}) = ${tc.toFixed(3)}`)
for(const eff of [Math.round(Math.abs(w.d)),340480,500000,1000000,2000000]){
  const ncp=eff/se, pw=1-(phi(tc-ncp)-phi(-tc-ncp))
  say(`  power to detect a TRUE lane busy shift of ${String(eff).padStart(8)} B  =  ${(pw*100).toFixed(1)}%`)
}
say(`  MINIMUM DETECTABLE EFFECT at 80% power = ${(se*(tc+0.842)).toFixed(0)} B = ${(se*(tc+0.842)/1048576).toFixed(2)} MiB`)
let nNeed=null
for(let n=3;n<=400;n++){
  const se2=sp*Math.sqrt(2/n), df=2*(n-1), tc2=df>=4?2.776:tcrit(df)
  if(se2*(tc2+0.842)<=340480){nNeed=n;say(`  runs per arm to bring the MDE to the claimed 340,480 B: n = ${n} per arm  (MDE ${(se2*(tc2+0.842)).toFixed(0)} B)`);break}
}
if(nNeed===null) say('  more than 400 runs per arm would be needed to reach the claimed 340,480 B')
else say(`  At 2.37 min per run that is 2 x ${nNeed} x 2.37 = ${(2*nNeed*2.37).toFixed(0)} min of wall clock.`)
say('  A NULL WITH ITS POWER COMPUTED. This is NOT "the lanes are the same"; it is')
say('  "n=3 on this rig cannot see a 340 KB difference in settled busy".')

say('')
say('=== THE ARENA: the chunk count, with every observation named ===')
say(`  this slice, FIBER     (c1,c2,c3): ${Cv.map(r=>r.chunks).join(', ')}`)
say(`  this slice, STACKLESS (b1,b2,b3): ${Bv.map(r=>r.chunks).join(', ')}`)
say('  evidence-variance, PRE  via HCSIZE 131079: 46, 46, 46')
say('  evidence-variance, POST via PROF :820    : 46, 46, 46')
say('  evidence-idle/on     (PRE)       HCSIZE 131079 = 46')
say('  evidence-postfix/sa  (FIBER)     PROF :820     = 47')
say('  evidence-postfix/sb  (STACKLESS) PROF :820     = 47')
const PRIOR=[46,46,46,46,46,46,46,47,47]
const tally={46:0,47:0}
for(const v of [...Cv.map(r=>r.chunks),...Bv.map(r=>r.chunks),...PRIOR]) tally[v]++
const N14=tally[46]+tally[47]
say(`  TALLY: 46 in ${tally[46]} of ${N14} observations, 47 in ${tally[47]} of ${N14}.`)
say('')
say('  THE DENOMINATOR IS NOT THE PREVIOUS SLICE\'S. a0e2c9fa3 reported "46 in 6 of')
say('  8, 47 in 2 of 8"; its 8 is the three v1 A-runs, the three v1 B-runs, sa and')
say(`  sb, and it EXCLUDED evidence-idle/on. This ${N14} is that 8, plus evidence-idle/on,`)
say('  plus this slice\'s six. The two fractions are over different populations and')
say('  must not be chained or compared as if they were the same ratio.')
say('')
say("  >>> AND THIS CORRECTS THE PREVIOUS SLICE'S CORRECTION. <<<")
say('  a0e2c9fa3 observed 47 in exactly two places, both in the same-day sa/sb')
say('  pair, and that coincidence left open the reading "47 is something about')
say('  that pair". c2 here is a THIRD 47: fiber lane, different session, from a')
say('  binary that read 46 in the two runs either side of it (46, 47, 46).')
say('  The count is a per-run draw over {46,47} and is nothing about the pair.')
say('  The previous headline correction -- 46 is modal, and the raise to 16.226%')
say('  rested on a draw -- STANDS and is strengthened: the draw is now')
say('  demonstrated WITHIN one binary inside one session.')
say('')
say('  ERROR BAR ON THE MEASURED FACTOR. The released bytes are N x 65,536. The')
say('  65,536 is a DEFINITION (SCR_STR_ARENA_CHUNK); N is the MEASUREMENT, and N')
say(`  is observed over {46,47} with mean ${((tally[46]*46+tally[47]*47)/N14).toFixed(3)} across ${N14} runs. The bar belongs on N:`)
say('  46 x 65,536 = 3,014,656 B and 47 x 65,536 = 3,080,192 B. The per-chunk')
say('  752 B granularity term is real but 87x smaller than this step, so it is')
say('  not the dominant term and was never the one to quote alone.')
say(`  chunk frees, all six runs: ${rows.map(r=>r.chunkFreed).join(', ')}. The free path exists`)
say('  (scr_string.c:822 via scr_str_idle_drain) and is not taken. FLOW IS NOT')
say('  RETENTION: PROF counts the whole run, the heap-0 row counts what is live')
say('  at census, and these two columns must not be subtracted from each other.')

say('')
say('=== THE PRE-REGISTERED PREDICTIONS, SCORED ===')
say('  P1  "the lane busy delta survives in sign and magnitude (-300 to -400 KB)')
say('       and IS SEPARABLE"')
say(`      REFUTED. Measured ${w.d.toFixed(0)} B, |t| = ${w.t.toFixed(2)} vs t_crit ${w.tc.toFixed(3)}: not separable.`)
say('      The sign survives; the magnitude and the separability do not.')
say('      AND IT FAILED BY THE EXACT ROUTE PRE-REGISTERED AS THE WEAK HALF --')
say(`      arm C's variance, not the effect. The prereg guessed "hundreds of KB"`)
say(`      for arm C's busy sd; it measured ${w.sA.toFixed(0)} B. That is the design`)
say('      working: the named risk is the one that fired.')
say('  P2  "the FIBER lane reads 46 chunks, not 47"')
say(`      WRONG AS WORDED. Fiber read ${Cv.map(r=>r.chunks).join(', ')}. But the claim P2 was serving --`)
say('      that 47 is a per-run draw and not a property of the sa/sb pair -- is')
say('      CONFIRMED, and more directly than 46-everywhere would have confirmed')
say('      it: the draw happened inside one binary in one session.')
say('  P3  "free, uncommitted and committed remain not separable"')
say(`      SPLIT. uncommitted ${all.unc.t>all.unc.tc?'IS':'is NOT'} separable (|t| ${all.unc.t.toFixed(2)}), as predicted; free and`)
say(`      committed cross the bar narrowly (|t| ${all.free.t.toFixed(2)}, ${all.committed.t.toFixed(2)} vs 4.303) and both`)
say('      revert to "no" on the pre-registered leave-one-out. Predicted wrong,')
say('      but not in a direction that supports the sentence under audit.')
say('')
say('=== WHAT THIS SLICE DOES NOT SHOW ===')
say('  - It does not measure PEAK anything. Every column here is the settled heap')
say('    at _Exit. The -21.117 MiB peak figure in the record is a different')
say('    quantity and is NOT touched, confirmed or refuted by this slice.')
say('  - It does not re-measure the string-arena repair. Both arms are post-fix;')
say('    the -3,020,443 B busy delta of a0e2c9fa3 stands untouched.')
say('  - It does not explain WHY arm C is wide. regions and free move with it')
say('    (see the spread table), which points at the allocator mapping more')
say('    segments on the fiber lane, but that is a hypothesis this slice did not')
say('    test and it is not asserted.')

if (process.env.V2_WRITE) writeFileSync(process.env.V2_WRITE, L.join('\n') + '\n')

/* RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY
 *
 * THE LINE THIS BAND ANSWERS, at :48 (and the same expression at :221):
 *
 *     committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],
 *
 * The field this script calls `committed` is busy + free, and it is the
 * column that carries the "YES" in RESULTS.txt's six-run table.
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
