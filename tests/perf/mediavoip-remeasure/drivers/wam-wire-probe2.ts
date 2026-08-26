// Static-lane driver for wam's wire path. Reproduces the assertions of
// packages/wam/src/wire/__tests__/wire.test.ts byte-for-byte.
import { BinaryWriter } from '../probe-wire2/binary-writer.js'
import { writeGlobalAttribute } from '../probe-wire2/encoder.js'
import { WamBatch } from '../probe-wire2/WamBatch.js'

function hex(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i].toString(16)
        s += b.length === 1 ? '0' + b : b
    }
    return s
}

function encodeGlobal(id: number, value: number | string | boolean | null): string {
    const writer = new BinaryWriter()
    writeGlobalAttribute(writer, id, value)
    return hex(writer.toBytes())
}

let fails = 0
function eq(actual: string, expected: string, label: string): void {
    if (actual !== expected) {
        fails += 1
        console.log('FAIL ' + label + ': got ' + actual + ' want ' + expected)
    } else {
        console.log('ok   ' + label + ' = ' + actual)
    }
}

const w = new BinaryWriter(4)
w.writeUint8(0x05)
w.writeUint16(0x0102)
w.writeUint32(0x0a0b0c0d)
w.writeInt8(-1)
w.writeString('hi')
eq(hex(w.toBytes()), '0501020a0b0c0dff6869', 'BinaryWriter big-endian + utf8')

const w0 = new BinaryWriter(0)
w0.writeUint32(0x0a0b0c0d)
eq(hex(w0.toBytes()), '0a0b0c0d', 'BinaryWriter zero capacity')

eq(encodeGlobal(5, 0), '1005', 'global int zero')
eq(encodeGlobal(5, 1), '2005', 'global int one')
eq(encodeGlobal(5, 100), '300564', 'global int8')
eq(encodeGlobal(5, 300), '4005012c', 'global int16')
eq(encodeGlobal(5, 'hi'), '8005026869', 'global string short')
eq(encodeGlobal(5, null), '0005', 'global null')
eq(encodeGlobal(5, true), '2005', 'global bool true')
eq(encodeGlobal(300, 1), '28012c', 'global extended id')

const batch = new WamBatch('regular', 7, 1, new Map<number, number | string | boolean | null>())
batch.writeEvent(100_000, 472, 1, [{ id: 1, kind: 'int', value: 3 }])
eq(batch.hasEvents() ? 'true' : 'false', 'true', 'batch hasEvents')
eq(hex(batch.toBytes()), '57414d0507000100302f642901d8360103', 'batch header+event+field')

const b2 = new WamBatch('regular', 1, 1, new Map<number, number | string | boolean | null>([[3543, 42]]))
const baseline = b2.size()
b2.setGlobal(3543, 42)
eq(b2.size() === baseline ? 'same' : 'grew', 'same', 'delta: unchanged global not re-emitted')
b2.setGlobal(3543, 99)
eq(b2.size() > baseline ? 'grew' : 'same', 'grew', 'delta: changed global re-emitted')

console.log(fails === 0 ? 'WAM-WIRE: ALL PASS' : 'WAM-WIRE: ' + fails + ' FAILURES')
