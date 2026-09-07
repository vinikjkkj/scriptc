// PROBE ARM 2: the SAME calls, with the receiver annotated `ChildProcess`.
// If arm 1 fences and arm 2 does not, the gap is the type-name mapping only.
import { spawn, type ChildProcess } from 'node:child_process'

const proc: ChildProcess = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
proc.stdout!.on('data', (chunk: Buffer) => { console.log('n=' + chunk.byteLength) })
proc.on('exit', () => { console.log('done') })
