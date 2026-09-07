// PROBE: is the SC2003 on `proc.stdout!` the NON-NULL ASSERTION, or the
// child-stdio surface? Arm: the same read narrowed by a guard instead of `!`.
import { spawn, type ChildProcess } from 'node:child_process'

const proc: ChildProcess = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
const out = proc.stdout
if (out) {
  out.on('data', (chunk: Buffer) => { console.log('n=' + chunk.byteLength) })
}
proc.on('exit', () => { console.log('done') })
