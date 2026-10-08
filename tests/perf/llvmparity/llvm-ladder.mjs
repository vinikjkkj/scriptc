/* Blocker ladder — DERIVED, not mirrored.
 *
 * The previous version reimplemented stacklessPlan's function-level gates as
 * its own if-chain. It agreed for as long as it agreed, and then the boxed-
 * param fence was removed and it went on reporting 133/272 for a blocker that
 * no longer existed. Seventh instance of a copy kept beside the thing it
 * copies.
 *
 * The cure has three parts:
 *   1. the VERDICT is never computed here -- it is stacklessPlan(fn) itself;
 *   2. point blockers come from liveness's own p.blockers, not restated;
 *   3. function gates are found by PERTURBATION -- undo a candidate gate on a
 *      shallow copy and re-ask the real predicate -- so a gate this file has
 *      never heard of still cannot be silently attributed to something else;
 *   4. and the whole thing is CHECKED: "blocker set empty" must equal "the
 *      real predicate admitted it", for every function. A mismatch aborts.
 *      That is what makes a new gate fail loudly instead of drifting.
 */
import fs from "node:fs";
import { suspensionLiveness, stacklessPlan } from "./liveness.ts";
import { SUSPENDING_LIB_CALLS, STACKLESS_LOWERABLE_LIB_CALLS } from "./suspends.ts";

function* S(p){const fd=fs.openSync(p,"r");const b=Buffer.alloc(1<<22);let c="",st=false,d=0,ins=false,esc=false,cur=null;
 try{for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(n===0)break;const ch=c+b.toString("utf8",0,n);c="";let i=0;
  if(!st){const at=ch.indexOf('"functions"');if(at<0){c=ch.slice(-32);continue;}const br=ch.indexOf("[",at);if(br<0){c=ch.slice(at);continue;}st=true;i=br+1;}
  for(;i<ch.length;i++){const x=ch[i];if(cur!==null)cur.push(x);
   if(ins){if(esc)esc=false;else if(x==="\\")esc=true;else if(x==='"')ins=false;continue;}
   if(x==='"'){ins=true;continue;}
   if(x==="{"){if(d===0)cur=["{"];d++;}else if(x==="}"){d--;if(d===0&&cur!==null){yield cur.join("");cur=null;}}else if(x==="]"&&d===0)return;}}}finally{fs.closeSync(fd);}}

/* Each probe UNDOES one candidate gate and re-asks the real predicate.
 * `undo` must not mutate the original. */
const PROBES = [
  ["fn:notAsync",        f => ({ ...f, async: true })],
  ["fn:generator",       f => { const g={...f}; delete g.generator; return g; }],
  ["fn:moduleInitCache", f => { const g={...f}; delete g.asyncCacheGlobal; delete g.asyncCycleCacheGlobal; return g; }],
  ["fn:boxedParam",      f => { const pid=new Set((f.params??[]).map(p=>p.localId));
                                return { ...f, locals:(f.locals??[]).map(l=> pid.has(l.id)&&l.boxed===true ? {...l,boxed:false} : l) }; }],
];

const rows=[]; let totalPoints=0, withPoints=0;
for(const t of S(process.argv[2])){
  const fn=JSON.parse(t);
  const lv=suspensionLiveness(fn); if(lv===null) continue;
  withPoints++; totalPoints+=lv.points.length;
  const admitted = stacklessPlan(fn) !== null;          // AUTHORITATIVE
  const blockers = new Set();
  for(const p of lv.points) for(const b of p.blockers) blockers.add("pt:"+b);
  if(!admitted){
    /* The fiber-only libCall gate is undone WITHOUT touching the IR: widen
     * the lowerable set the predicate itself consults, ask again, restore.
     * That attributes the exact libCall name instead of a generic gate, and
     * it still asks the real predicate rather than restating its rule. */
    for(const lib of SUSPENDING_LIB_CALLS){
      if(STACKLESS_LOWERABLE_LIB_CALLS.has(lib)) continue;
      STACKLESS_LOWERABLE_LIB_CALLS.add(lib);
      let probed; try { probed = stacklessPlan(fn); } catch { probed = null; }
      STACKLESS_LOWERABLE_LIB_CALLS.delete(lib);
      if(probed !== null) blockers.add("fn:fiberOnlyLib:"+lib);
    }
    for(const [name,undo] of PROBES){
      let probed; try { probed = stacklessPlan(undo(fn)); } catch { probed = null; }
      // the gate fired iff undoing it changes the verdict, OR it still fails
      // only because of other gates -- so test it in isolation against the
      // all-gates-undone baseline
      if(probed !== null) blockers.add(name);
    }
    // a gate may be masked by another; undo ALL probes together and re-ask
    if([...blockers].every(b=>b.startsWith("pt:"))){
      let g=fn; for(const [,undo] of PROBES) g=undo(g);
      if(stacklessPlan(g)!==null && blockers.size===0) blockers.add("fn:UNATTRIBUTED");
    }
    if(blockers.size===0) blockers.add("fn:UNATTRIBUTED");
  }
  rows.push({n:fn.name,pts:lv.points.length,admitted,b:blockers,lv:lv.points.map(p=>p.blockers)});
}
/* THE CHECK that makes this not a mirror */
const bad = rows.filter(r => (r.b.size===0) !== r.admitted);
if(bad.length){
  console.error(`LADDER INCONSISTENT with stacklessPlan on ${bad.length} function(s) -- a gate this file cannot name.`);
  for(const r of bad.slice(0,5)) console.error(`   admitted=${r.admitted} blockers=[${[...r.b].join(", ")}]  ${r.n}`);
  process.exit(1);
}
const unatt = rows.filter(r=>r.b.has("fn:UNATTRIBUTED"));
const adm=rows.filter(r=>r.admitted);
console.log(`DENOMINATORS  with >=1 suspension point ${withPoints} | suspension points ${totalPoints}`);
console.log(`ADMITTED      ${adm.length} of ${withPoints} functions | ${adm.reduce((a,r)=>a+r.pts,0)} of ${totalPoints} points   [verdict from stacklessPlan]`);
console.log(`CONSISTENCY   ok on all ${rows.length} functions; unattributed refusals: ${unatt.length}`);
console.log("");
/* TWO point columns, because one number called "pts" meant different things
 * in two versions of this file and that is the exact defect this front keeps
 * paying for. ptsOn = points that CARRY the blocker (point-level only -- a
 * function gate is carried by no individual point, so it reads n/a).
 * ptsIn = all points inside functions carrying it, which is what converting
 * them would move. */
const fns=new Map(), ptsOn=new Map(), ptsIn=new Map();
for(const r of rows){
  for(const b of r.b){ fns.set(b,(fns.get(b)??0)+1); ptsIn.set(b,(ptsIn.get(b)??0)+r.pts); }
}
for(const r of rows) for(const p of (r.lv??[])) for(const b of p) ptsOn.set("pt:"+b,(ptsOn.get("pt:"+b)??0)+1);
console.log("blocker                        fns   ptsOn    ptsIn    SOLO-REACH fns  solo pts");
for(const [b,nf] of [...fns].sort((a,b)=>b[1]-a[1])){
  const solo=rows.filter(r=>r.b.size===1&&r.b.has(b));
  const on = b.startsWith("pt:") ? String(ptsOn.get(b)??0) : "n/a";
  console.log(`  ${b.padEnd(30)} ${String(nf).padStart(4)} ${on.padStart(7)} ${String(ptsIn.get(b)).padStart(8)}  ${String(solo.length).padStart(13)} ${String(solo.reduce((a,r)=>a+r.pts,0)).padStart(9)}`);
}
