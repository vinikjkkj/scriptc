// Render the scored cells as one text table per shape.
// argv: <scored.json> ...
import { readFileSync } from 'node:fs'

const RHS = ['Uint8Array', 'Int8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'DataView', 'ArrayBuffer', 'SharedArrayBuffer', 'Buffer', 'Object']
const SHORT = { Uint8Array: 'u8', Int8Array: 'i8', Uint8ClampedArray: 'u8c', Int16Array: 'i16', Uint16Array: 'u16', Int32Array: 'i32', Uint32Array: 'u32', Float32Array: 'f32', Float64Array: 'f64', BigInt64Array: 'bi64', BigUint64Array: 'bu64', DataView: 'DV', ArrayBuffer: 'AB', SharedArrayBuffer: 'SAB', Buffer: 'Buf', Object: 'Obj' }

for (const f of process.argv.slice(2)) {
  const s = JSON.parse(readFileSync(f, 'utf8'))
  const by = new Map(s.rows.map((r) => [r.id, r]))
  const vals = [...new Set(s.rows.map((r) => r.id.split(':')[1]))]
  const shape = s.rows[0].id.split(':')[0]
  console.log('\n### shape ' + shape + '   ' + JSON.stringify(s.tally) + '   (' + f + ')')
  console.log('cell key:  T=true  f=false  .=refused (TRAP)  !=WRONG  ?=did-not-run')
  console.log('value'.padEnd(7) + RHS.map((c) => SHORT[c].padStart(5)).join(''))
  for (const v of vals) {
    let line = v.padEnd(7)
    for (const c of RHS) {
      const r = by.get(shape + ':' + v + ':' + c)
      let m
      if (!r) m = ' '
      else if (r.verdict === 'TRAP') m = '.'
      else if (r.verdict === 'DID-NOT-RUN') m = '?'
      else if (r.verdict === 'WRONG') m = '!' + r.got[0] + '/' + r.node[0]
      else m = r.got === 'true' ? 'T' : 'f'
      line += m.padStart(5)
    }
    console.log(line)
  }
}
