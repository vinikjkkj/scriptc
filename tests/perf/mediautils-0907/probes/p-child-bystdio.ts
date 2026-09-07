// PROBE: is `ChildProcessByStdio<...>.stdout` / `.on` a missing RUNTIME, or
// only a missing TYPE-NAME mapping? spawn(cmd, args, {stdio:[...]}) selects
// the @types/node overload returning ChildProcessByStdio<I,O,E>, whose symbol
// name is not "ChildProcess" — the one name mapType matches.
// ARM 1: the shape media-utils writes, verbatim minus the timeout option.
import { spawn } from 'node:child_process'

const proc = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
proc.stdout.on('data', (chunk: Buffer) => { console.log('n=' + chunk.byteLength) })
proc.on('exit', () => { console.log('done') })
