/* ladder-noprofile.mjs — the client entry WITHOUT in-process self-profiling.
 *
 *   node ladder-noprofile.mjs <bench-dir>
 *
 * Why this rung exists, in one number: at main acba2b2d the block `lastfence`
 * measured the messaging bench at 21 unique fences in the emitted C, and
 * **18 of them are one surface** — `node:inspector`'s `Session`: `new
 * Session()` plus `.connect` / `.post` x10 / `.on` x2 / `.removeListener` x2 /
 * `.disconnect`, every one an SC1090 "method calls on a class value with no
 * lowering". Those 18 are not zapo's messaging code. They are the shape stub
 * that `tests/perf/fakebench/unmask.mjs` puts in front of the unsupported
 * module so the measurement behind the gate can exist at all.
 *
 * A compiled binary embeds no V8, so `node:inspector/promises` is not a
 * lowering that was forgotten — there is nothing to drive. And this fleet's
 * own standard for a CPU or memory number is to read it from OUTSIDE the
 * process (PeakWorkingSetSize, QueryProcessCycleTime), never from an
 * in-process V8 profiler. So the honest client entry does not self-profile:
 * BenchProfiler keeps its whole public surface and does nothing.
 *
 * This is a MEASUREMENT patch to a COPY. zapo is read-only test input; the
 * finding is that zapo's client bench entry should not carry the profiler,
 * not that this script is a fix.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from 'node:path'

const dir = process.argv[2]
if (dir === undefined) {
  console.error('usage: ladder-noprofile.mjs <bench-dir>')
  process.exit(2)
}
const file = join(dir, 'messaging.bench.ts')
const text = readFileSync(file, 'utf8')
if (text.includes('\r')) {
  console.error('CRLF; refusing to rewrite line endings')
  process.exit(3)
}
const lines = text.split('\n')

const INERT = `class BenchProfiler {
    public readonly options: ProfilerOptions

    public constructor(options: ProfilerOptions) {
        this.options = options
    }

    public get enabled(): boolean {
        return false
    }

    public async start(): Promise<void> {
        if (
            this.options.cpu ||
            this.options.heap ||
            this.options.snapshot ||
            this.options.snapshotPerScenario
        ) {
            console.error(
                '[profiler] in-process V8 profiling is unavailable in a compiled binary; ' +
                    'measure CPU and memory from outside the process instead'
            )
        }
        await Promise.resolve()
    }

    public async beforeScenario(_name: string): Promise<void> {
        await Promise.resolve()
    }

    public async afterScenario(_name: string): Promise<void> {
        await Promise.resolve()
    }

    public async stop(): Promise<void> {
        await Promise.resolve()
    }

    public async takeHeapSnapshot(_label: string): Promise<void> {
        await Promise.resolve()
    }
}`

const start = lines.findIndex((l) => l.startsWith('class BenchProfiler {'))
if (start < 0) {
  console.error('no BenchProfiler declaration')
  process.exit(4)
}
let end = -1
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i] === '}') {
    end = i
    break
  }
}
if (end < 0) {
  console.error('no BenchProfiler terminator')
  process.exit(5)
}
/* The JSDoc above it describes the wrapper that is going away, so it goes
 * too — otherwise the leftover check trips on prose, which is the exact
 * mistake `unmask.mjs` records having made. */
let from = start
if (lines[from - 1] === ' */') {
  while (from > 0 && !lines[from - 1].startsWith('/**')) from--
  from--
}
lines.splice(from, end - from + 1, ...INERT.split('\n'))

/* The stub import goes with it. Both spellings, plus the real module in case
 * this runs on an un-unmasked copy. */
let dropped = 0
for (let i = lines.length - 1; i >= 0; i--) {
  if (
    /^import .*__inspector-stub/.test(lines[i]) ||
    /^import .*['"]node:inspector\/promises['"]/.test(lines[i])
  ) {
    lines.splice(i, 1)
    dropped++
  }
}
if (dropped === 0) {
  console.error('no inspector import found — refusing to claim a no-profile entry')
  process.exit(6)
}

const out = lines.join('\n')

/* Self-test. Every name that must be gone, and every name that must survive. */
const MUST_BE_ZERO = ['InspectorSession', 'this.session']
for (const k of MUST_BE_ZERO) {
  const n = out.split(k).length - 1
  if (n !== 0) {
    console.error(`self-test: '${k}' still appears ${n} time(s)`)
    process.exit(7)
  }
}
/* Only a QUOTED specifier is a leftover import. The phrase also occurs in
 * prose, and a check that cannot tell a comment from an import fails on a
 * file that is completely patched. */
const specifier = /(['"])(?:node:inspector(?:\/promises)?|\.\/__inspector-stub)\1/g
const leftover = [...out.matchAll(specifier)]
if (leftover.length > 0) {
  console.error(`self-test: ${leftover.length} inspector specifier(s) still imported`)
  process.exit(7)
}
for (const k of [
  'class BenchProfiler',
  'beforeScenario',
  'afterScenario',
  'takeHeapSnapshot',
  'profiler.options',
  'mainSeparateProcess',
  'scenarioSend1to1',
  'scenarioRecvGroup',
  'WaClient',
]) {
  if (!out.includes(k)) {
    console.error(`self-test: '${k}' was removed and must not be`)
    process.exit(8)
  }
}
if (out.length >= text.length) {
  console.error('self-test: file did not shrink')
  process.exit(9)
}
writeFileSync(file, out)

/* The stub FILE stays on disk. It leaves the compiled graph the moment the
 * client stops importing it, but `server-process.ts` — the Node child, which
 * is never compiled — still imports it at run time, and deleting it would
 * break the fake server rather than the client. */
const stub = join(dir, '__inspector-stub.ts')
if (!existsSync(stub)) {
  console.error('warning: no __inspector-stub.ts here; server-process.ts may not need one')
}

console.log(
  `no-profile entry: ${text.split('\n').length} lines -> ${lines.length} lines, ` +
    `${dropped} inspector import(s) dropped (stub file kept for the Node child)`,
)
