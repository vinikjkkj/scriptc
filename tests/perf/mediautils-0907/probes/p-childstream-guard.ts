// PROBE: the child-stdio listener path with the receiver narrowed IN PLACE
// (no intermediate binding, no `!`) — the shape lowerChildStreamMethodCall
// documents as supported.
import { spawn, type ChildProcess } from 'node:child_process'

const proc: ChildProcess = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
if (proc.stdout) {
  proc.stdout.on('data', (chunk: Buffer) => { console.log('n=' + chunk.byteLength) })
  proc.stdout.on('end', () => { console.log('end') })
}
proc.on('exit', () => { console.log('done') })
