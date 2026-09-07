// PROBE (control): the same as p-annot-optchain with the chunk annotated
// Buffer -- under @types/node an unannotated 'data' chunk infers `unknown`,
// which is a listener-shape fence, not a child-surface one.
import { spawn, type ChildProcess } from 'node:child_process'

const child: ChildProcess = spawn('/bin/sh', ['-c', "printf 'hi\n'"], { stdio: ['ignore', 'pipe', 'pipe'] })
let n = 0
child.stdout?.on('data', (chunk: Buffer) => { n += chunk.byteLength })
child.stdout?.on('end', () => { console.log('n=' + n) })
child.on('exit', (code) => { console.log('exit:' + code) })
