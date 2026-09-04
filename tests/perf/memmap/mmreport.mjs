/**
 * mmreport.mjs - the attribution table for a scr_memmap.h snapshot.
 *
 *   node tests/perf/memmap/mmreport.mjs <snapshot.mm.txt> [more.mm.txt ...]
 *   node tests/perf/memmap/mmreport.mjs --self-test
 *
 * Turns one high-water snapshot into the peak-RSS decomposition, and states
 * the two things a memory report has to state or it is not evidence:
 *
 *   COVERAGE   how close the snapshot's own total came to the kernel's
 *              PeakWorkingSetSize. The sampler polls, so it can miss the
 *              instant of the peak; if it did, the table is a floor and says
 *              so instead of being read as the answer.
 *   CLOSURE    whether the classes sum to the snapshot total. They do by
 *              construction, so a mismatch means the parser or the instrument
 *              is broken, and it is an error rather than a rounding note.
 *
 * The heap line is the point of the exercise. HeapWalk gives committed, busy
 * and per-block overhead separately, so the CRT's slack -- committed pages
 * that hold no live object -- is a measured number rather than the remainder
 * of a subtraction. That slack is invisible to tests/perf/prof/scr_prof.h by
 * construction: every byte of it has already been charged back to its site on
 * free, which is why a residency profile that reports ptrLost=0 can still
 * leave a quarter of peak RSS unexplained.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MiB = 1024 * 1024
const mib = (b) => (b / MiB).toFixed(2)

/** Parse one snapshot. Pure, so the self-test drives it with a literal. */
export function parseSnapshot(text) {
  const out = {
    tag: null, why: null, snapshots: 0,
    kernel: {}, walk: {}, cost: {},
    classes: {}, classesCommitted: {}, heapTotal: {}, heaps: [], modules: [], regions: []
  }
  const num = (s, k) => {
    const m = new RegExp(`\\b${k}=(\\d+)`).exec(s)
    return m ? Number(m[1]) : null
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('MEMMAP ')) {
      out.tag = /\btag=(\S+)/.exec(line)?.[1] ?? null
      out.why = /\bwhy=(\S+)/.exec(line)?.[1] ?? null
      out.snapshots = num(line, 'snapshots') ?? 0
    } else if (line.startsWith('KERNEL ')) {
      for (const k of ['wsNow', 'wsPeak', 'privateUsage', 'faults']) out.kernel[k] = num(line, k)
    } else if (line.startsWith('WALK ')) {
      for (const k of ['resident', 'committed', 'sharedResident', 'orphanResident', 'orphanUnresolved', 'regions'])
        out.walk[k] = num(line, k)
    } else if (line.startsWith('COST ')) {
      for (const k of ['heapWalkMs', 'vmWalkMs', 'pageBucketMs']) out.cost[k] = num(line, k)
    } else if (line.startsWith('CLASS ')) {
      const name = line.split(/\s+/)[1]
      out.classes[name] = num(line, 'resident')
      out.classesCommitted[name] = num(line, 'committed')
    } else if (line.startsWith('HEAPTOTAL ')) {
      for (const k of ['heaps', 'committed', 'uncommitted', 'busyBytes', 'busyCount', 'freeBytes', 'freeCount', 'overhead', 'mallocHeapIdx'])
        out.heapTotal[k] = num(line, k)
    } else if (line.startsWith('HEAP ')) {
      out.heaps.push({
        walked: num(line, 'walked'), err: num(line, 'err'),
        committed: num(line, 'committed'), busyBytes: num(line, 'busyBytes'),
        busyCount: num(line, 'busyCount'), freeBytes: num(line, 'freeBytes'),
        freeCount: num(line, 'freeCount'), overhead: num(line, 'overhead')
      })
    } else if (line.startsWith('MODULE ')) {
      out.modules.push({ name: line.split(/\s+/)[1], resident: num(line, 'resident'), imageSize: num(line, 'imageSize') })
    } else if (line.startsWith('REGION ')) {
      out.regions.push({ cls: num(line, 'cls'), size: num(line, 'size'), resident: num(line, 'resident') })
    }
  }
  return out
}

/** The two integrity checks, returned rather than printed so they can be tested. */
export function audit(s) {
  const classSum = Object.values(s.classes).reduce((a, b) => a + b, 0)
  const closure = classSum - (s.walk.resident ?? 0)
  const coverage = s.kernel.wsPeak ? (s.walk.resident / s.kernel.wsPeak) : null
  // Slack: committed heap pages that hold neither a live object nor its header.
  const ht = s.heapTotal
  const slack = (ht.committed ?? 0) - (ht.busyBytes ?? 0) - (ht.overhead ?? 0)
  const perBlock = ht.busyCount ? (ht.overhead / ht.busyCount) : null
  const unwalked = s.heaps.filter((h) => !h.walked).length
  return { classSum, closure, coverage, slack, perBlock, unwalked }
}

export function render(s) {
  const a = audit(s)
  const L = []
  L.push(`# ${s.tag ?? '-'}  (why=${s.why}, snapshots=${s.snapshots})`)
  L.push(`  kernel wsPeak ${mib(s.kernel.wsPeak)} MiB   privateUsage ${mib(s.kernel.privateUsage)} MiB   faults ${s.kernel.faults}`)
  L.push(`  snapshot total ${mib(s.walk.resident)} MiB = ${(a.coverage * 100).toFixed(1)}% of the kernel peak` +
    (a.coverage < 0.97 ? '   <-- SAMPLER MISSED THE PEAK; the table below is a FLOOR' : ''))
  if (a.closure !== 0) L.push(`  !! CLOSURE ERROR: classes sum to ${a.classSum}, snapshot says ${s.walk.resident}`)
  if (s.walk.orphanUnresolved) L.push(`  !! ${s.walk.orphanUnresolved} B of resident pages could not be classed`)
  if (a.unwalked) L.push(`  !! ${a.unwalked} heap(s) refused to walk - the HEAP row is an UNDERCOUNT`)
  L.push('')
  L.push('  class        resident MiB   committed MiB   share of peak')
  const order = ['HEAP', 'IMAGE', 'STACK', 'MAPPED', 'PRIVATE', 'INSTRUMENT']
  for (const k of order) {
    if (s.classes[k] === undefined) continue
    const pct = (s.classes[k] / s.walk.resident * 100).toFixed(1)
    L.push(`  ${k.padEnd(12)} ${mib(s.classes[k]).padStart(12)}   ${mib(s.classesCommitted[k]).padStart(13)}   ${pct.padStart(6)}%`)
  }
  L.push('')
  const ht = s.heapTotal
  L.push(`  HEAP interior (HeapWalk over ${ht.heaps} heap(s), malloc lives in heap #${ht.mallocHeapIdx})`)
  L.push(`    committed        ${mib(ht.committed).padStart(9)} MiB`)
  L.push(`    live objects     ${mib(ht.busyBytes).padStart(9)} MiB   in ${ht.busyCount} blocks`)
  L.push(`    block overhead   ${mib(ht.overhead).padStart(9)} MiB   = ${a.perBlock?.toFixed(2)} B/block MEASURED`)
  L.push(`    free, committed  ${mib(ht.freeBytes).padStart(9)} MiB   in ${ht.freeCount} spans`)
  L.push(`    slack (com-busy-ovh) ${mib(a.slack).padStart(5)} MiB   <- committed, touched, holding nothing`)
  L.push(`    uncommitted      ${mib(ht.uncommitted).padStart(9)} MiB   (reserved only; costs no RSS)`)
  if (s.modules.length) {
    L.push('')
    L.push('  top resident modules')
    for (const m of [...s.modules].sort((x, y) => y.resident - x.resident).slice(0, 8))
      L.push(`    ${m.name.padEnd(24)} ${mib(m.resident).padStart(8)} MiB of ${mib(m.imageSize)} MiB image`)
  }
  const big = s.regions.filter((r) => r.cls === 5 && r.resident > 1 * MiB)
  if (big.length) {
    L.push('')
    L.push('  unclassified private regions over 1 MiB resident')
    for (const r of big.sort((x, y) => y.resident - x.resident).slice(0, 10))
      L.push(`    ${mib(r.resident).padStart(8)} MiB resident of ${mib(r.size)} MiB committed`)
  }
  L.push(`\n  snapshot cost: heapWalk ${s.cost.heapWalkMs}ms  vmWalk ${s.cost.vmWalkMs}ms  pageBucket ${s.cost.pageBucketMs}ms`)
  return L.join('\n')
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  // A snapshot with KNOWN arithmetic: classes sum to resident, heap slack is
  // a number computed by hand below, so a parser that silently drops a field
  // fails here rather than in a report nobody can check.
  const fixture = [
    'MEMMAP v1 tag=fix why=highwater snapshots=7 pid=1',
    'KERNEL wsNow=200000000 wsPeak=209715200 privateUsage=220000000 faults=500000',
    'WALK resident=104857600 committed=209715200 sharedResident=8388608 orphanResident=0 orphanUnresolved=0 regions=400',
    'COST heapWalkMs=60 vmWalkMs=1 pageBucketMs=2',
    'CLASS INSTRUMENT resident=2097152 committed=5242880 residentMiB=2.00',
    'CLASS IMAGE resident=18874368 committed=27262976 residentMiB=18.00',
    'CLASS MAPPED resident=1048576 committed=2097152 residentMiB=1.00',
    'CLASS STACK resident=10485760 committed=12582912 residentMiB=10.00',
    'CLASS HEAP resident=71303168 committed=83886080 residentMiB=68.00',
    'CLASS PRIVATE resident=1048576 committed=1048576 residentMiB=1.00',
    'HEAPTOTAL heaps=2 committed=83886080 uncommitted=16777216 busyBytes=50331648 busyCount=1000000 freeBytes=8388608 busyN=0 freeCount=900 overhead=12000000 mallocHeapIdx=1',
    'HEAP 0 handle=0x1 walked=1 err=259 committed=83886080 busyBytes=50331648 busyCount=1000000 freeBytes=8388608 freeCount=900 overhead=12000000',
    'MODULE bench.exe resident=17000000 imageSize=26911744',
    'END'
  ].join('\n')
  const s = parseSnapshot(fixture)
  const a = audit(s)
  const eq = (what, got, want) => {
    if (got !== want) throw new Error(`self-test: ${what} = ${got}, expected ${want}`)
  }
  eq('classSum', a.classSum, 104857600)
  eq('closure', a.closure, 0)
  eq('heap busyCount', s.heapTotal.busyCount, 1000000)
  eq('slack', a.slack, 83886080 - 50331648 - 12000000)
  eq('perBlock', a.perBlock, 12)
  eq('unwalked', a.unwalked, 0)
  eq('modules', s.modules.length, 1)
  eq('coverage', Math.round(a.coverage * 1000), 500)

  // NEGATIVE CONTROL: a snapshot whose classes do NOT sum must be reported as
  // a closure error, not quietly rendered. An instrument that cannot fail
  // cannot be believed when it passes.
  const broken = parseSnapshot(fixture.replace('CLASS HEAP resident=71303168', 'CLASS HEAP resident=1'))
  if (audit(broken).closure === 0) throw new Error('self-test: a broken snapshot passed the closure check')
  // NEGATIVE CONTROL: an unwalkable heap must be counted.
  const refused = parseSnapshot(fixture.replace('walked=1 err=259', 'walked=0 err=998'))
  if (audit(refused).unwalked !== 1) throw new Error('self-test: an unwalked heap was not flagged')
  console.log('mmreport self-test PASS (7 positives, 2 negative controls)')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args[0] === '--self-test') selfTest()
  else if (args.length === 0) { console.error('usage: mmreport.mjs <snapshot.mm.txt> ... | --self-test'); process.exit(2) }
  else for (const f of args) console.log(render(parseSnapshot(readFileSync(f, 'utf8'))) + '\n')
}
