// After the server ends the connection the same socket object connects
// again: its 'connect' listener and its data listener fire on the new life.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(49914, '127.0.0.1', () => {
  const A = new Socket()
  let round = 0
  A.on('connect', () => console.log('A connect event round', round))
  A.on('data', (d: Buffer) => console.log('A data', String(d)))
  A.on('end', () => console.log('A end'))
  A.on('close', () => {
    console.log('A close round', round)
    if (round === 1) { srv.close(() => console.log('srv closed')); return }
    round = 1
    A.connect(49914, '127.0.0.1', () => { console.log('A second connect cb'); A.write('two') })
  })
  A.connect(49914, '127.0.0.1', () => { console.log('A first connect cb'); A.write('one') })
})
