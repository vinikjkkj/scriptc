// store-redis/helpers.ts: its only ioredis import is `import type Redis`,
// erased; its zapo-js/util import is a VALUE import, so this driver needs
// --provenance-sources and nothing else. scanKeys/deleteKeysChunked take a
// live Redis and are deliberately not driven.
import {
    assertSafeKeyPrefix,
    bytesToHex,
    hexToBytes,
    safeLimit,
    toBytesOrNull,
    toRedisBuffer,
    toStringOrNull,
    uint8Equal,
    uint8TimingSafeEqual
} from '../pkgs/store-redis/helpers'

function show(v: Uint8Array | null): string {
    return v === null ? 'null' : bytesToHex(v)
}

function safe(prefix: string): string {
    try {
        assertSafeKeyPrefix(prefix)
        return 'ok'
    } catch (e) {
        return (e as Error).message
    }
}

const bytes = new Uint8Array([0, 1, 127, 128, 255])
console.log('1 hex:', bytesToHex(bytes))
console.log('2 roundtrip:', bytesToHex(hexToBytes(bytesToHex(bytes))))
console.log('3 toBytesOrNull null:', show(toBytesOrNull(null)))
console.log('4 toBytesOrNull undefined:', show(toBytesOrNull(undefined)))
console.log('5 toBytesOrNull empty string:', show(toBytesOrNull('')))
console.log('6 toBytesOrNull bytes:', show(toBytesOrNull(bytes)))
console.log('7 toStringOrNull empty:', toStringOrNull(''))
console.log('8 toStringOrNull value:', toStringOrNull('abc'))
console.log('9 toStringOrNull null:', toStringOrNull(null))
console.log('10 prefix ok:', safe('wa:store_1:'))
console.log('11 prefix bad:', safe('wa store'))
console.log('12 prefix empty:', safe(''))
console.log('13 equal:', uint8Equal(bytes, new Uint8Array([0, 1, 127, 128, 255])))
console.log('14 not equal:', uint8Equal(bytes, new Uint8Array([0, 1, 127, 128, 254])))
console.log('15 timing equal:', uint8TimingSafeEqual(bytes, new Uint8Array([0, 1, 127, 128, 255])))
console.log('16 timing len:', uint8TimingSafeEqual(bytes, new Uint8Array([0, 1])))
console.log('17 buffer len:', toRedisBuffer(bytes).length)
console.log('18 buffer hex:', toRedisBuffer(bytes).toString('hex'))
console.log('19 limit:', safeLimit(10, 50))
console.log('20 limit default:', safeLimit(undefined, 50))
let limitErr = 'no throw'
try {
    safeLimit(0, 50)
} catch (e) {
    limitErr = (e as Error).message
}
console.log('21 limit 0 throws:', limitErr)
