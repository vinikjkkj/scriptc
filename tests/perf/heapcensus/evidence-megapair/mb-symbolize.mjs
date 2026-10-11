import { buildModMap, resolverFor } from 'file:///G:/scriptc/tests/perf/obj-symbols.mjs'
const EXE='G:/blocks/mb-out182-prof/zapo-rest-182.exe'
const PDB='G:/blocks/mb-out182-prof/zapo-rest-182.pdb'
const maps=[]
for (const [obj,mod,kind] of [
 ['G:/blocks/mb-zig-local/o/0fbf49cb6e2aa35f19c1d2bcc31e769f/zapo-rest.obj','zapo-rest\.obj','prog'],
 ['G:/blocks/mb-zig-local/o/74170598a6a22c21a1f6f4fd4b05097b/scr_bytes.obj','scr_bytes\.obj','scr_bytes'],
]) {
  try { const m=buildModMap({exe:EXE,pdb:PDB,obj,mod}); console.log(kind+': '+(m.ok?'USABLE':'REFUSED')+'  '+m.checks.map(c=>c.join('=')).join(' | '))
        if(m.ok) maps.push({...m,kind}) } catch(e){ console.log(kind+': ERROR '+e.message) }
}
const r=resolverFor(maps,rva=>({name:'<unmapped>',off:0,kind:'-'}))
const stacks={
 'A 8x934576 (m1:661)':'1fee16 1fe85e 2035a9 202f5b 16e1a2 1a30bc9 1a35a4d 1a35abc',
 'B 8x1048576 (m1:662)':'65a5e8 173390 310923110 3136ccaa9',
 'C 8x934576 (m1:663)':'10d6cb 14c4d3 201f76 1fe8e8 2035a9 202f5b 16e1a2 1a30bc9',
 'D 1x1048576 (m1:660)':'214402 20c1d9 214f0e 21081e 9fff9b a00fee a0167c a03198 1a0c48b 221871',
}
for(const [k,v] of Object.entries(stacks)){
  console.log('\n'+k)
  for(const f of v.split(' ')){ const x=r(parseInt(f,16)); console.log('   '+f.padStart(10)+'  '+x.name+'+'+x.off) }
}
