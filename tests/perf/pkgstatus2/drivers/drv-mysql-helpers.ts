// store-mysql/helpers.ts: its only mysql2 import is
// `import type { FieldPacket, ResultSetHeader } from 'mysql2/promise'` —
// erased. Its zapo-js/util import is a VALUE import, so this driver needs
// --provenance-sources and nothing else. No mysql2 name is written in this
// file, so nothing here depends on mysql2's shape at run time.
import {
    affectedRows,
    assertSafeTablePrefix,
    bytesToHex,
    queryFirst,
    queryRows,
    safeLimit,
    toBytes,
    toBytesOrNull,
    uint8Equal,
    uint8TimingSafeEqual
} from '../pkgs/store-mysql/helpers'

function safe(prefix: string): string {
    try {
        assertSafeTablePrefix(prefix)
        return 'ok'
    } catch (e) {
        return (e as Error).message
    }
}

function show(v: Uint8Array | null): string {
    return v === null ? 'null' : bytesToHex(v)
}

const bytes = new Uint8Array([0, 1, 127, 128, 255])
const rows = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]

console.log('1 queryRows length:', queryRows([rows, []]).length)
console.log('2 queryRows first id:', String(queryRows([rows, []])[0]!['id']))
const first = queryFirst([rows, []])
console.log('3 queryFirst id:', first === undefined ? 'undefined' : String(first['id']))
const none = queryFirst([[], []])
console.log('4 queryFirst empty:', none === undefined ? 'undefined' : 'defined')
console.log('5 affectedRows:', affectedRows([{ affectedRows: 7 }, []]))

console.log('6 toBytes uint8:', bytesToHex(toBytes(bytes)))
console.log('7 toBytes arraybuffer:', bytesToHex(toBytes(bytes.buffer)))
let threw = 'no throw'
try {
    toBytes(42)
} catch (e) {
    threw = (e as Error).message
}
console.log('8 toBytes rejects a number:', threw)
console.log('9 toBytesOrNull null:', show(toBytesOrNull(null)))
console.log('10 toBytesOrNull undefined:', show(toBytesOrNull(undefined)))
console.log('11 toBytesOrNull bytes:', show(toBytesOrNull(bytes)))

console.log('12 prefix ok:', safe('wa_store_1'))
console.log('13 prefix bad:', safe('wa-store'))
console.log('14 prefix empty:', safe(''))

console.log('15 equal:', uint8Equal(bytes, new Uint8Array([0, 1, 127, 128, 255])))
console.log('16 not equal:', uint8Equal(bytes, new Uint8Array([0, 1, 127, 128, 254])))
console.log('17 timing equal:', uint8TimingSafeEqual(bytes, new Uint8Array([0, 1, 127, 128, 255])))
console.log('18 timing length mismatch:', uint8TimingSafeEqual(bytes, new Uint8Array([0, 1])))
console.log('19 limit:', safeLimit(10, 50))
console.log('20 limit default:', safeLimit(undefined, 50))
let limitErr = 'no throw'
try {
    safeLimit(0, 50)
} catch (e) {
    limitErr = (e as Error).message
}
console.log('21 limit 0 throws:', limitErr)
