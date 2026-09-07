// PROBE: the EXACT shape tests/corpus/1565-spawn-pipe-streams.ts uses, which
// passes in the corpus. The corpus compiles against the SHIPPED FALLBACK
// declarations; this file compiles against real @types/node 24.13.3, which is
// the lane media-utils is on.
import { spawn } from 'node:child_process'

const child = spawn('/bin/sh', ['-c', "printf 'hi\n'"], { stdio: ['ignore', 'pipe', 'pipe'] })
let n = 0
child.stdout?.on('data', (chunk) => { n += chunk.byteLength })
child.stdout?.on('end', () => { console.log('n=' + n) })
child.on('exit', (code) => { console.log('exit:' + code) })
