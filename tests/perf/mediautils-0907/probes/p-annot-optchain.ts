// PROBE: annotated ChildProcess (so the receiver maps to `child`) + the
// OPTIONAL-CHAIN read the corpus uses. Isolates the `Readable | null` question
// from the ChildProcessByStdio question.
import { spawn, type ChildProcess } from 'node:child_process'

const child: ChildProcess = spawn('/bin/sh', ['-c', "printf 'hi\n'"], { stdio: ['ignore', 'pipe', 'pipe'] })
let n = 0
child.stdout?.on('data', (chunk) => { n += chunk.byteLength })
child.stdout?.on('end', () => { console.log('n=' + n) })
child.on('exit', (code) => { console.log('exit:' + code) })
