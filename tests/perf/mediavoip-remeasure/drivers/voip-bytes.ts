// Static-lane driver for voip/bytes.ts. Reproduces the assertions of
// packages/voip/src/__tests__/bytes.test.ts.
//
// In the default lane this module is an island: `import ... from 'zapo-js'` at
// bytes.ts:1 refuses, 0 statements are analysed. Under --provenance-sources it
// analyses 29 statements with none failed, so it should reach a binary.
import {
    concatBytes,
    readBigUInt64BE,
    readUInt16BE,
    readUInt32BE,
    readUInt32LE,
    toArrayBuffer,
    toBytesView,
    writeBigUInt64BE,
    writeUInt16BE,
    writeUInt32BE,
    writeUInt32LE
} from '../pkgs/voip/bytes.js'

let fails = 0
function eq(actual: string, expected: string, label: string): void {
    if (actual !== expected) {
        fails += 1
        console.log('FAIL ' + label + ': got ' + actual + ' want ' + expected)
    } else {
        console.log('ok   ' + label + ' = ' + actual)
    }
}

function hex(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i].toString(16)
        s += b.length === 1 ? '0' + b : b
    }
    return s
}

const buf16 = new Uint8Array(2)
writeUInt16BE(buf16, 0xabcd, 0)
eq(hex(buf16), 'abcd', 'writeUInt16BE bytes')
eq(readUInt16BE(buf16, 0).toString(16), 'abcd', 'readUInt16BE round-trip')

const buf32 = new Uint8Array(4)
writeUInt32BE(buf32, 0x12345678, 0)
eq(hex(buf32), '12345678', 'writeUInt32BE bytes')
eq(readUInt32BE(buf32, 0).toString(16), '12345678', 'readUInt32BE round-trip')

const bufLe = new Uint8Array(4)
writeUInt32LE(bufLe, 0x89abcdef, 0)
eq(hex(bufLe), 'efcdab89', 'writeUInt32LE bytes')
eq(readUInt32LE(bufLe, 0).toString(16), '89abcdef', 'readUInt32LE round-trip')

const buf64 = new Uint8Array(8)
writeBigUInt64BE(buf64, 0x0123456789abcdefn, 0)
eq(hex(buf64), '0123456789abcdef', 'writeBigUInt64BE bytes')
eq(readBigUInt64BE(buf64, 0).toString(16), '123456789abcdef', 'readBigUInt64BE round-trip')

eq(hex(concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])), '010203', 'concatBytes order')

const ab = new Uint8Array([4, 5, 6]).buffer
eq(hex(toBytesView(ab)), '040506', 'toBytesView over ArrayBuffer')

const view = new DataView(new Uint8Array([7, 8, 9, 10]).buffer, 1, 2)
eq(hex(toBytesView(view)), '0809', 'toBytesView over a DataView window')

const round = toArrayBuffer(new Uint8Array([1, 2, 3]))
eq(hex(new Uint8Array(round)), '010203', 'toArrayBuffer round-trip')

console.log(fails === 0 ? 'VOIP-BYTES: ALL PASS' : 'VOIP-BYTES: ' + fails + ' FAILURES')
