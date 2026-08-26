// Minimal repro: `scriptc coverage` reports this program 100% static (0 failed
// statements, no blockers, no runtime fences), it builds WITHOUT --best-effort,
// and it throws at run time inside zapo-js's own source.
//
// zapo-js src/util/bytes.ts:251-253
//     if (value instanceof Uint8Array) {
//         return value.constructor === Uint8Array
//             ? value
//             : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
//
// Each case below prints its label BEFORE the call, so the last label printed
// names the arm that threw.
import { toBytesView } from '../pkgs/voip/bytes.js'

function hex(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i].toString(16)
        s += b.length === 1 ? '0' + b : b
    }
    return s
}

console.log('case 1: plain Uint8Array')
console.log('  -> ' + hex(toBytesView(new Uint8Array([1, 2, 3]))))

console.log('case 2: DataView window')
const backing = new Uint8Array([7, 8, 9, 10])
console.log('  -> ' + hex(toBytesView(new DataView(backing.buffer, 1, 2))))

console.log('BYTESVIEW-REPRO: reached the end')
