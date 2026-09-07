// PROBE: the SAME listener registration through `!` — the doc comment says
// `!` is transparent to isChildStdioAccess.
import { spawn, type ChildProcess } from 'node:child_process'

const proc: ChildProcess = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
proc.stdout!.on('data', (chunk: Buffer) => { console.log('n=' + chunk.byteLength) })
proc.on('exit', () => { console.log('done') })
