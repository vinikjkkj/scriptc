/* Ceiling, DERIVED from stacklessPlan, with the reachability test fixed.
 *
 * Two defects in the first version, both mine:
 *  1. it mirrored the gate list, so it still said "admitted 990" after the
 *     boxedParam fence came out (real: 1,099) -- the same copy-beside-source
 *     defect I had just fixed in the ladder;
 *  2. "reachable" was "has at least one blocker NOT in the out-of-scope set",
 *     which counts {finally, loop} as reachable even though closing loop
 *     leaves finally. Reachable must mean NO out-of-scope blocker at all.
 *
 * USAGE (tsx resolves the .js specifiers in the compiler sources):
 *   npx tsx tests/perf/corostate/stackless-ceiling.mts <program>.ir.json
 * Produce the dump with `scriptc build <entry> --emit-ir`. OUTSET=pt:finally,... to vary the out-of-scope set.
 */
import fs from "node:fs";
import { suspensionLiveness, stacklessPlan } from "../../../packages/compiler/src/ir/liveness.js";
import { SUSPENDING_LIB_CALLS, STACKLESS_LOWERABLE_LIB_CALLS } from "../../../packages/compiler/src/ir/suspends.js";
function* S(p){const fd=fs.openSync(p,"r");const b=Buffer.alloc(1<<22);let c="",st=false,d=0,ins=false,esc=false,cur=null;
 try{for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(n===0)break;const ch=c+b.toString("utf8",0,n);c="";let i=0;
  if(!st){const at=ch.indexOf('"functions"');if(at<0){c=ch.slice(-32);continue;}const br=ch.indexOf("[",at);if(br<0){c=ch.slice(at);continue;}st=true;i=br+1;}
  for(;i<ch.length;i++){const x=ch[i];if(cur!==null)cur.push(x);
   if(ins){if(esc)esc=false;else if(x==="\\")esc=true;else if(x==='"')ins=false;continue;}
   if(x==='"'){ins=true;continue;}
   if(x==="{"){if(d===0)cur=["{"];d++;}else if(x==="}"){d--;if(d===0&&cur!==null){yield cur.join("");cur=null;}}else if(x==="]"&&d===0)return;}}}finally{fs.closeSync(fd);}}
const OUT=new Set((process.env.OUTSET??"pt:finally,fn:generator,pt:kind=yieldExpr,pt:kind=agenResume").split(","));
const rows=[]; let TP=0;
for(const t of S(process.argv[2])){
  const fn=JSON.parse(t); const lv=suspensionLiveness(fn); if(lv===null) continue;
  TP+=lv.points.length;
  const admitted=stacklessPlan(fn)!==null;            // AUTHORITATIVE
  const b=new Set();
  if(!admitted){
    for(const p of lv.points) for(const x of p.blockers) b.add("pt:"+x);
    for(const lib of SUSPENDING_LIB_CALLS){ if(STACKLESS_LOWERABLE_LIB_CALLS.has(lib)) continue;
      STACKLESS_LOWERABLE_LIB_CALLS.add(lib); const q=stacklessPlan(fn); STACKLESS_LOWERABLE_LIB_CALLS.delete(lib);
      if(q!==null) b.add("fn:fiberOnlyLib:"+lib); }
    const pid=new Set((fn.params??[]).map(p=>p.localId));
    if(stacklessPlan({...fn,locals:(fn.locals??[]).map(l=>pid.has(l.id)&&l.boxed===true?{...l,boxed:false}:l)})!==null) b.add("fn:boxedParam");
    if(fn.generator!==undefined) b.add("fn:generator");
    if(fn.asyncCacheGlobal!==undefined||fn.asyncCycleCacheGlobal!==undefined) b.add("fn:moduleInitCache");
    if(b.size===0) b.add("fn:UNATTRIBUTED");
  }
  rows.push({pts:lv.points.length,admitted,b});
}
const bad=rows.filter(r=>(r.b.size===0)!==r.admitted);
if(bad.length){ console.error(`INCONSISTENT with stacklessPlan on ${bad.length}`); process.exit(1); }
const T=rows.length, sum=a=>a.reduce((x,r)=>x+r.pts,0), pc=(a,b)=>(100*a/b).toFixed(1);
const adm=rows.filter(r=>r.admitted);
const un=rows.filter(r=>!r.admitted);
const blocked=un.filter(r=>[...r.b].some(x=>OUT.has(x)));   // carries ANY out-of-scope blocker
const reach=un.filter(r=>![...r.b].some(x=>OUT.has(x)));    // every blocker is in scope
console.log(`out-of-scope set: ${[...OUT].join(", ")}`);
console.log(`population: ${T} functions with >=1 point, ${TP} points   [verdicts from stacklessPlan]`);
console.log(`  ADMITTED today      ${adm.length} of ${T} (${pc(adm.length,T)}%)   ${sum(adm)} of ${TP} points (${pc(sum(adm),TP)}%)`);
console.log(`  BLOCKED out of scope ${blocked.length} of ${T} (${pc(blocked.length,T)}%)   ${sum(blocked)} of ${TP} points (${pc(sum(blocked),TP)}%)`);
console.log(`  REACHABLE in scope   ${reach.length} of ${T} (${pc(reach.length,T)}%)   ${sum(reach)} of ${TP} points (${pc(sum(reach),TP)}%)`);
console.log(`  CEILING             ${adm.length+reach.length} of ${T} (${pc(adm.length+reach.length,T)}%)   ${sum(adm)+sum(reach)} of ${TP} points (${pc(sum(adm)+sum(reach),TP)}%)`);
