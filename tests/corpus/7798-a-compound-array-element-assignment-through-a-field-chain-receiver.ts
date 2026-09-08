// `a[i] op= e` used to require the receiver to be a bare identifier or `this`,
// because lowerElemCompound re-lowers the receiver and the index once for the
// read and once for the write. A chain of PLAIN DATA FIELDS over an identifier
// or `this` is just as repeatable -- a field read runs no user code -- so it is
// admitted now, and an accessor link still refuses (a getter called twice where
// JS calls it once is a silent wrong answer, and that case is a diagnostics
// fixture, not this one).
//
// `d` is the load-bearing line: it reads the element through an ALIAS taken
// before the compound write. If the receiver chain had produced a copy rather
// than the object itself, the alias would still read the pre-write value.
class Srtp {
    ivBuffer = new Uint8Array(16)
    ssrcBuffer = new Uint8Array(4)
    nums: number[] = [1, 2, 3, 4]
    inner = { buf: new Uint8Array(4) }
    xor(): void {
        for (let i = 0; i < 4; i++) {
            this.ivBuffer[4 + i] ^= this.ssrcBuffer[i]!
        }
    }
}

const s = new Srtp()
s.ssrcBuffer[0] = 0xf0
s.ssrcBuffer[1] = 0x0f
s.ivBuffer[4] = 0x11
s.ivBuffer[5] = 0x22
s.xor()
console.log('a=' + String(s.ivBuffer[4]) + ',' + String(s.ivBuffer[5]))

// identifier.<field>[index], over a plain numeric array
s.nums[1] += 10
s.nums[0] *= 3
console.log('b=' + s.nums.join(','))

// a two-link field chain
s.inner.buf[2] = 5
s.inner.buf[2] += 7
console.log('c=' + String(s.inner.buf[2]))

// the write must land on the object itself, not on a copy
const alias = s.inner.buf
console.log('d=' + String(alias[2]))
