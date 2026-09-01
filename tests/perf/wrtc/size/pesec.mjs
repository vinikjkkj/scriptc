/* PE/COFF section sizes, read straight out of the headers. There is no
 * objdump on this host, and a size delta with no section attribution is a
 * number nobody can act on. */
import { readFileSync } from 'node:fs'
function sections(path) {
  const b = readFileSync(path)
  const pe = b.readUInt32LE(0x3c)
  if (b.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('not PE: ' + path)
  const nsec = b.readUInt16LE(pe + 6)
  const optSize = b.readUInt16LE(pe + 20)
  let off = pe + 24 + optSize
  const out = new Map()
  for (let i = 0; i < nsec; i++, off += 40) {
    const name = b.toString('ascii', off, off + 8).replace(/\0+$/, '')
    out.set(name, b.readUInt32LE(off + 16)) // SizeOfRawData
  }
  return out
}
const [pa, pb] = process.argv.slice(2)
const A = sections(pa), B = sections(pb)
const keys = [...new Set([...A.keys(), ...B.keys()])].sort()
const pad = (s, n) => String(s).padStart(n)
console.log(`A = ${pa}`)
console.log(`B = ${pb}`)
console.log(`${'section'.padEnd(12)}${pad('A', 12)}${pad('B', 12)}${pad('B-A', 12)}`)
let ta = 0, tb = 0
for (const k of keys) {
  const x = A.get(k) ?? 0, y = B.get(k) ?? 0
  ta += x; tb += y
  const d = y - x
  console.log(`${k.padEnd(12)}${pad(x, 12)}${pad(y, 12)}${pad(d > 0 ? '+' + d : d, 12)}`)
}
console.log(`${'TOTAL raw'.padEnd(12)}${pad(ta, 12)}${pad(tb, 12)}${pad('+' + (tb - ta), 12)}`)
