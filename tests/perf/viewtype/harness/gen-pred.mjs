// The SIBLING predicates -- everything other than `instanceof` a program uses
// to ask "what kind of bytes is this?".  Same cell discipline as the
// instanceof matrix: one self-contained block per (value, predicate), its own
// try/catch, node runs the identical file as the oracle.
//
// Predicates come in two spellings on purpose.  The plain ones read the
// TYPED surface.  The `dyn*` ones read the same property through an
// `any`-typed helper, which is a DIFFERENT lowering (the checked-dynamic
// box) -- keeping them apart is what stops an `any`-read defect from being
// reported as a defect of the property itself.
import { writeFileSync } from 'node:fs'

const TAB = String.fromCharCode(9)

const VALUES = [
  { id: 'u8', expr: 'new Uint8Array([1, 2, 3])' },
  { id: 'i8', expr: 'new Int8Array([1, 2, 3])' },
  { id: 'i32', expr: 'new Int32Array([1, 2])' },
  { id: 'f64', expr: 'new Float64Array([1, 2])' },
  { id: 'dv', expr: 'new DataView(new ArrayBuffer(8))' },
  { id: 'ab', pre: ['const own = new Uint8Array(8)'], expr: 'own.buffer' },
  { id: 'buf', expr: 'Buffer.from([1, 2, 3])' },
  { id: 'sub', pre: ['const whole = new Uint8Array([1, 2, 3, 4])'], expr: 'whole.subarray(1, 3)' },
]

const PREDS = [
  { id: 'isView', code: 'str(ArrayBuffer.isView(val))' },
  { id: 'isBuffer', code: 'str(Buffer.isBuffer(val))' },
  { id: 'toStringTag', code: 'Object.prototype.toString.call(val)' },
  { id: 'ctorName', code: 'val.constructor.name' },
  { id: 'ctorIsU8', code: 'str(val.constructor === Uint8Array)' },
  { id: 'typeof', code: 'typeof val' },
  { id: 'byteLength', code: 'str(val.byteLength)' },
  { id: 'isArray', code: 'str(Array.isArray(val))' },
  { id: 'clonedTag', code: 'Object.prototype.toString.call(structuredClone(val))' },
  { id: 'clonedIsU8', code: 'str(structuredClone(val) instanceof Uint8Array)' },
  { id: 'dynCtorName', code: 'anyOf(val).constructor.name' },
  { id: 'dynCtorIsU8', code: 'str(anyOf(val).constructor === Uint8Array)' },
  { id: 'dynCtorIsBuffer', code: 'str(anyOf(val).constructor === Buffer)' },
  { id: 'dynByteLength', code: 'str(anyOf(val).byteLength)' },
  { id: 'dynLength', code: 'str(anyOf(val).length)' },
]

const PRE = [
  'function str(v: unknown): string {',
  '    return String(v)',
  '}',
  '/* eslint-disable-next-line @typescript-eslint/no-explicit-any */',
  'function anyOf(v: unknown): any {',
  '    return v',
  '}',
  'function shout(label: string, s: string): void {',
  "    console.log(label + '" + TAB + "' + s)",
  '}',
]

function emit(disabled) {
  const lines = []
  const cells = {}
  for (const p of PRE) lines.push(p)
  for (const v of VALUES) {
    for (const pr of PREDS) {
      const id = 'P:' + v.id + ':' + pr.id
      const off = disabled.has(id)
      const c = off ? '// ' : ''
      const start = lines.length + 1
      lines.push(c + '{ // CELL ' + id)
      lines.push(c + '    try {')
      for (const q of v.pre ?? []) lines.push(c + '        ' + q)
      lines.push(c + '        const val = ' + v.expr)
      lines.push(c + "        shout('" + id + "', " + pr.code + ')')
      lines.push(c + '    } catch (e) {')
      lines.push(c + "        shout('" + id + "', 'THROW')")
      lines.push(c + '    }')
      lines.push(c + '}')
      cells[id] = { start, end: lines.length, off }
    }
  }
  lines.push("console.log('MATRIX-END')")
  return { text: lines.join('\n') + '\n', cells }
}

const disabled = new Set(process.argv[5] ? JSON.parse(process.argv[5]) : [])
const r = emit(disabled)
writeFileSync(process.argv[3], r.text)
writeFileSync(process.argv[4], JSON.stringify(r.cells, null, 1))
console.log('cells=' + Object.keys(r.cells).length + ' disabled=' + disabled.size)
