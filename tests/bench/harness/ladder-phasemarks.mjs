/* ladder-phasemarks.mjs — bracket each scenario with the markers
 * tests/perf/cpuphase reads, so CPU and RSS can be sampled from OUTSIDE the
 * process.
 *
 *   node ladder-phasemarks.mjs <bench-dir>
 *
 * Why this rung exists: `process.cpuUsage()` has no lowering, so the compiled
 * lane cannot report its own CPU, and `process.memoryUsage()`'s V8-heap
 * fields are refused by name. A column that prints a number it cannot know is
 * worse than one that says n/a — and the fix is not to delete the column, it
 * is to measure from a parent that reads the child's kernel counters
 * (QueryProcessCycleTime, GetProcessTimes, PeakWorkingSetSize). Those exist
 * for any child regardless of what its runtime exposes, which is exactly what
 * makes the compiled lane and the node lane comparable on ONE instrument.
 *
 * The markers go around `run()` inside `runScenarios`' own `runOne`, which is
 * OUTSIDE the region the bench times itself — the two `console.log`s cannot
 * move `elapsedMs`. They are applied to the same source both lanes execute,
 * so neither lane gets an instrument the other does not.
 *
 * This is a MEASUREMENT patch to a COPY. zapo is read-only test input.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (dir === undefined) {
  console.error('usage: ladder-phasemarks.mjs <bench-dir>')
  process.exit(2)
}
const file = join(dir, 'messaging.bench.ts')
const text = readFileSync(file, 'utf8')
if (text.includes('\r')) {
  console.error('CRLF; refusing to rewrite line endings')
  process.exit(3)
}
/* Only a marker in EMITTING position counts as already-instrumented. The
 * phrase also occurs in prose — bench-client5's printResult explains where the
 * external CPU number comes from — and a guard that cannot tell a comment
 * from a console.log refuses a file that is completely unpatched. That is the
 * third time in this session that a comment/code confusion has produced a
 * wrong verdict; unmask.mjs records the first. */
if (/console\.log\(`\[phase-begin\]/.test(text)) {
  console.error('already marked; refusing to double-instrument')
  process.exit(4)
}
const lines = text.split('\n')

const start = lines.findIndex((l) => l.includes('const runOne = async (name: string'))
if (start < 0) {
  console.error('no runOne declaration — the shape this patch expects is gone')
  process.exit(5)
}
/* The three lines it edits, checked by content before anything is written. */
const iTry = start + 2
const iRun = start + 3
const iFin = start + 6
if (
  lines[iTry].trim() !== 'try {' ||
  lines[iRun].trim() !== 'const r = await run()' ||
  lines[iFin].trim() !== '} finally {'
) {
  console.error('runOne body is not the shape this patch expects:')
  console.error(lines.slice(start, start + 8).join('\n'))
  process.exit(6)
}
const ind = ' '.repeat(lines[iRun].length - lines[iRun].trimStart().length)
lines.splice(
  iRun,
  1,
  `${ind}// cpuphase brackets: sampled by the PARENT, outside the timed region.`,
  `${ind}console.log(\`[phase-begin] \${name}\`)`,
  `${ind}const r = await run()`,
  `${ind}console.log(\`[phase-end] \${name}\`)`,
)

const out = lines.join('\n')

/* Self-test. A patch that reports success without changing the program is the
 * failure mode this fleet keeps paying for — and a HALF-applied one, with a
 * begin and no end, would make cpuphase attribute the rest of the run to the
 * last phase and read like a real finding. */
/* Count markers in EMITTING position only — the same prose/code distinction
 * the idempotence guard above needs, and for the same file. */
const nBegin = (out.match(/console\.log\(`\[phase-begin\]/g) ?? []).length
const nEnd = (out.match(/console\.log\(`\[phase-end\]/g) ?? []).length
if (nBegin !== 1 || nEnd !== 1) {
  console.error(`self-test: ${nBegin} begin marker(s), ${nEnd} end marker(s), expected 1 and 1`)
  process.exit(7)
}
for (const k of ['const r = await run()', 'results.push(r)', 'printResult(r)', 'mainSeparateProcess', 'WaClient']) {
  if (!out.includes(k)) {
    console.error(`self-test: '${k}' was removed and must not be`)
    process.exit(8)
  }
}
if (out.length <= text.length) {
  console.error('self-test: file did not grow')
  process.exit(9)
}
writeFileSync(file, out)
console.log(`phase marks: ${text.split('\n').length} lines -> ${lines.length} lines, 1 begin / 1 end around runOne's run()`)
