// Generate the instanceof matrix probe programs.
//
// One CELL = one (value, declaration shape, right-hand-side constructor)
// triple.  Every cell is a self-contained block with its own try/catch, so a
// refusal or a runtime throw in one cell cannot take another cell's answer
// with it.  The generator writes a sidecar JSON mapping every source line to
// the cell that owns it, so a compiler diagnostic can be attributed exactly.
//
// The oracle answer is NOT hardcoded anywhere: node runs the very same file
// and its output is the reference.  A cell the compiler refuses is simply
// absent from the compiled program's output and is scored TRAP.

import { writeFileSync } from 'node:fs'

const TAB = String.fromCharCode(9)

// ---------------------------------------------------------------- values
// `pre` lines are emitted inside the cell block, before the declaration.
const VALUES = [
  { id: 'u8', expr: 'new Uint8Array([1, 2, 3])', t: 'Uint8Array', view: true },
  { id: 'i8', expr: 'new Int8Array([1, 2, 3])', t: 'Int8Array', view: true },
  { id: 'u8c', expr: 'new Uint8ClampedArray([1, 2, 3])', t: 'Uint8ClampedArray', view: true },
  { id: 'i16', expr: 'new Int16Array([1, 2])', t: 'Int16Array', view: true },
  { id: 'u16', expr: 'new Uint16Array([1, 2])', t: 'Uint16Array', view: true },
  { id: 'i32', expr: 'new Int32Array([1, 2])', t: 'Int32Array', view: true },
  { id: 'u32', expr: 'new Uint32Array([1, 2])', t: 'Uint32Array', view: true },
  { id: 'f32', expr: 'new Float32Array([1, 2])', t: 'Float32Array', view: true },
  { id: 'f64', expr: 'new Float64Array([1, 2])', t: 'Float64Array', view: true },
  { id: 'bi64', expr: 'new BigInt64Array(2)', t: 'BigInt64Array', view: true },
  { id: 'bu64', expr: 'new BigUint64Array(2)', t: 'BigUint64Array', view: true },
  { id: 'dv', expr: 'new DataView(new ArrayBuffer(8))', t: 'DataView', view: true },
  { id: 'ab', pre: ['const own = new Uint8Array(8)'], expr: 'own.buffer', t: 'ArrayBuffer', view: false },
  { id: 'sab', expr: 'new SharedArrayBuffer(8)', t: 'SharedArrayBuffer', view: false },
  { id: 'buf', expr: 'Buffer.from([1, 2, 3])', t: 'Buffer', view: true },
  { id: 'sub', pre: ['const whole = new Uint8Array([1, 2, 3, 4])'], expr: 'whole.subarray(1, 3)', t: 'Uint8Array', view: true },
]

// ------------------------------------------------------- right-hand sides
const RHS = [
  'Uint8Array', 'Int8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  'DataView', 'ArrayBuffer', 'SharedArrayBuffer', 'Buffer', 'Object',
]

// -------------------------------------------------------------- preamble
// `forgedTag`/`plainObject` are functions so their declared RETURN type is
// what the cell's slot sees -- a plain object claiming to be a Uint8Array,
// which is what a forged Symbol.toStringTag buys an attacker in Node.
const PRE = [
  "function show(label: string, v: boolean): void {",
  "    console.log(label + '" + TAB + "' + (v ? 'true' : 'false'))",
  "}",
  "function shout(label: string, s: string): void {",
  "    console.log(label + '" + TAB + "' + s)",
  "}",
]

// The three declaration SHAPES a real program spells a byte value in.
//  D  the inferred concrete type -- what `const b = new DataView(...)` gives
//  U  zapo's `toBytesView` parameter union, where the defect was found
//  K  an `unknown` slot -- the checked-dynamic path, a different lowering
const SHAPES = {
  D: { ann: null, ok: () => true },
  U: { ann: 'Uint8Array | ArrayBuffer | ArrayBufferView', ok: (v) => v.view || v.id === 'ab' },
  K: { ann: 'unknown', ok: () => true },
  // V  the DISPATCH union a binary protocol writes -- `Uint8Array | DataView`
  //    is the one shape whose two arms the IR cannot tell apart at all
  V: { ann: 'Uint8Array | DataView', ok: (v) => ['u8', 'dv', 'buf', 'sub'].includes(v.id) },
  // W  the abstract view base on its own
  W: { ann: 'ArrayBufferView', ok: (v) => v.view },
}

function emit(shapeKey, rhsList, disabled) {
  const shape = SHAPES[shapeKey]
  const lines = []
  const cells = {}
  const push = (s) => lines.push(s)
  for (const p of PRE) push(p)
  for (const v of VALUES) {
    if (!shape.ok(v)) continue
    for (const ctor of rhsList) {
      const id = shapeKey + ':' + v.id + ':' + ctor
      const off = disabled.has(id)
      const c = off ? '// ' : ''
      const start = lines.length + 1
      push(c + '{ // CELL ' + id)
      push(c + '    try {')
      for (const p of v.pre ?? []) push(c + '        ' + p)
      const ann = shape.ann ? ': ' + shape.ann : ''
      push(c + '        const val' + ann + ' = ' + v.expr)
      push(c + "        show('" + id + "', val instanceof " + ctor + ')')
      push(c + '    } catch (e) {')
      push(c + "        shout('" + id + "', 'THROW')")
      push(c + '    }')
      push(c + '}')
      cells[id] = { start, end: lines.length, off }
    }
  }
  push("console.log('MATRIX-END')")
  return { text: lines.join('\n') + '\n', cells }
}

const shapeKey = process.argv[2]
const outTs = process.argv[3]
const outJson = process.argv[4]
const disabled = new Set(process.argv[5] ? JSON.parse(process.argv[5]) : [])
const r = emit(shapeKey, RHS, disabled)
writeFileSync(outTs, r.text)
writeFileSync(outJson, JSON.stringify(r.cells, null, 1))
console.log('cells=' + Object.keys(r.cells).length + ' disabled=' + disabled.size + ' lines=' + r.text.split('\n').length)
