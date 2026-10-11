/* lp-symbolize.mjs -- name the PRODUCER that evidence-megapair left unmapped.
 *
 * mb.symbols.txt resolved stack A (8 x 934,576) to <unmapped> in every frame:
 * its map carried only zapo-rest.obj and scr_bytes.obj, and the producer lives
 * in neither. This adds the three runtime TUs the frames actually fall in,
 * found by locating each RVA in the PDB's .text section contributions.
 *
 * NEVER THE PDB FOR NAMES. On the LLVM lane the emitted module has no debug
 * stream and Publics misnames a frame as the nearest preceding export. The
 * PDB is used here only for the per-module .text RANGE; every NAME comes from
 * the COFF symbol table of the object the linker consumed. buildModMap refuses
 * a map unless EVERY public that falls inside that module's range agrees with
 * the object's own table -- that refusal is the control, and it is reported.
 *
 * INPUTS ARE NOT COMMITTED (33 MB exe, 234 objects, 242 MB .ll). The paths
 * below are mb-out182-prof and its zig cache on this host. If they are gone
 * the script says so and exits 0; lp.symbols.txt holds the captured output.
 *
 *   node tests/perf/heapcensus/evidence-livepair/lp-symbolize.mjs
 */
import { existsSync } from 'node:fs'
import { buildModMap, resolverFor } from 'file:///G:/scriptc/tests/perf/obj-symbols.mjs'

const EXE = 'G:/blocks/mb-out182-prof/zapo-rest-182.exe'
const PDB = 'G:/blocks/mb-out182-prof/zapo-rest-182.pdb'
/* obj, module-name regex for the PDB module list, label */
const MODS = [
  ['G:/blocks/mb-zig-local/o/0fbf49cb6e2aa35f19c1d2bcc31e769f/zapo-rest.obj', 'zapo-rest\.obj', 'prog'],
  ['G:/blocks/mb-zig-local/o/74170598a6a22c21a1f6f4fd4b05097b/scr_bytes.obj', 'scr_bytes\.obj', 'scr_bytes'],
  ['G:/blocks/mb-zig-local/o/7f42c989035739da46c18c611be2bfc7/scr_stream.obj', 'scr_stream\.obj', 'scr_stream'],
  ['G:/blocks/mb-zig-local/o/c151f7317d21e84ffd5304c08042b625/scr_async.obj', 'scr_async\.obj', 'scr_async'],
  ['G:/blocks/mb-zig-local/o/5fa85ef476fceb96a4d8a025a43b5bb6/scr_json.obj', 'scr_json\.obj', 'scr_json'],
  ['G:/blocks/mb-zig-global/o/98723314f43d36b8d2319808f366d381/crt2.obj', 'crt2\.obj', 'crt2'],
]
/* frames exactly as evidence-megapair/m1.prof.txt recorded them; frame 0 is
 * the note site and frame 1 is scr_bytes_alloc+488 for A, B and C. */
const STACKS = {
  'A 8x934576 (m1:661)': '1fee16 1fe85e 2035a9 202f5b 16e1a2 1a30bc9 1a35a4d 1a35abc',
  'B 8x1048576 (m1:662)': '65a5e8 173390 310923110 3136ccaa9',
  'C 8x934576 (m1:663)': '10d6cb 14c4d3 201f76 1fe8e8 2035a9 202f5b 16e1a2 1a30bc9',
  'D 1x1048576 (m1:660)': '214402 20c1d9 214f0e 21081e 9fff9b a00fee a0167c a03198 1a0c48b 221871',
}

if (!existsSync(EXE) || !MODS.every(m => existsSync(m[0]))) {
  console.log('INPUTS ABSENT on this host -- see lp.symbols.txt for the captured run.')
  for (const p of [EXE, ...MODS.map(m => m[0])]) if (!existsSync(p)) console.log('  missing: ' + p)
  process.exit(0)
}

const maps = []
for (const [obj, mod, kind] of MODS) {
  try {
    const m = buildModMap({ exe: EXE, pdb: PDB, obj, mod })
    console.log(kind + ': ' + (m.ok ? 'MAP USABLE' : 'MAP REFUSED') + '  ' +
      m.checks.map(c => c.join('=')).join(' | '))
    if (m.ok) maps.push({ ...m, kind })
  } catch (e) { console.log(kind + ': ERROR ' + e.message) }
}
const r = resolverFor(maps, () => ({ name: '<unmapped>', off: 0, kind: '-' }))
for (const [k, v] of Object.entries(STACKS)) {
  console.log('\n' + k)
  for (const f of v.split(' ')) {
    const x = r(parseInt(f, 16))
    console.log('   ' + f.padStart(10) + '  ' + x.name + '+' + x.off + '  [' + x.kind + ']')
  }
}
