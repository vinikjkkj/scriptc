// `x instanceof Uint8Array` in the static lane, against node as the oracle.
//
// Every operand is declared through the union zapo's `toBytesView` uses,
// `Uint8Array | ArrayBuffer | ArrayBufferView`, because that is the shape the
// failure was found in. A row marked WRONG is a SILENT wrong answer: no
// diagnostic, no runtime fence, exit 0.
//
// CONTROLS, both printed on every run in both lanes:
//   row 1  MUST print `ok` and `true`  -- a real Uint8Array. If this is WRONG,
//          the lowering is broken in a way that has nothing to do with views
//          and the rows below say nothing.
//   last   MUST print `WRONG` -- it hands `show` an answer that disagrees with
//          its `want` on purpose. If it prints `ok`, the reporter cannot say
//          "wrong" at all and every `ok` above is void.
function show(label: string, got: boolean, want: boolean): void {
    const g = got ? 'true ' : 'false'
    const w = want ? 'true ' : 'false'
    console.log((got === want ? 'ok    ' : 'WRONG ') + label + ' got=' + g + ' node=' + w)
}

const backing = new Uint8Array([7, 8, 9, 10])

// 1. CONTROL: a real Uint8Array. Must be `ok true` in both lanes.
const a: Uint8Array | ArrayBuffer | ArrayBufferView = new Uint8Array([1, 2, 3])
show('Uint8Array   ', a instanceof Uint8Array, true)

// 2. a DataView over the same backing buffer
const b: Uint8Array | ArrayBuffer | ArrayBufferView = new DataView(backing.buffer, 1, 2)
show('DataView     ', b instanceof Uint8Array, false)

// 3. a Uint8Array window over the same backing buffer, taken through
//    `subarray` rather than a constructor
const c: Uint8Array | ArrayBuffer | ArrayBufferView = backing.subarray(1, 3)
show('subarray     ', c instanceof Uint8Array, true)

// 4. CONTROL: must print WRONG in both lanes.
show('REPORTER     ', true, false)

console.log('INSTANCEOF-MATRIX: reached the end')
