// PROBE: the two events media-utils needs that the corpus does not use --
// child.on("close") and stream.on("close") -- on an already-mapped receiver.
import { spawn, type ChildProcess } from 'node:child_process'

const child: ChildProcess = spawn('/bin/sh', ['-c', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] })
child.on('close', (code) => { console.log('close:' + code) })
child.stdout?.on('close', () => { console.log('stdout close') })
