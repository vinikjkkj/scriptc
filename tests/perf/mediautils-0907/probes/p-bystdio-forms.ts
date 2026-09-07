// PROBE MATRIX after the ChildProcessByStdio mapping: which read form of a
// tuple-stdio child's stdout lowers, under real @types/node.
import { spawn } from 'node:child_process'

const a = spawn('/bin/sh', ['-c', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] })
a.stdout?.on('data', (c: Buffer) => { console.log('a' + c.byteLength) })   // L6 optional chain
const b = spawn('/bin/sh', ['-c', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] })
b.stdout.on('data', (c: Buffer) => { console.log('b' + c.byteLength) })    // L8 plain (type is non-null)
const d = spawn('/bin/sh', ['-c', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] })
d.stdout!.on('data', (c: Buffer) => { console.log('d' + c.byteLength) })   // L10 non-null assertion
const e = spawn('/bin/sh', ['-c', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] })
e.on('exit', (code) => { console.log('e' + code) })                        // L12 child.on("exit")
