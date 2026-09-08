// Compound assignment to an array element through a FIELD-CHAIN receiver.
// The fence used to require a bare identifier or `this`; a chain of plain data
// fields is just as repeatable, and an accessor link must still refuse.
class Srtp {
    ivBuffer = new Uint8Array(16)
    ssrcBuffer = new Uint8Array(4)
    nums: number[] = [1, 2, 3, 4]
    inner = { buf: new Uint8Array(4) }
    xor(): void {
        for (let i = 0; i < 4; i++) {
            this.ivBuffer[4 + i] ^= this.ssrcBuffer[i]!   // this.<field>[expr]
        }
    }
}
const s = new Srtp()
s.ssrcBuffer[0] = 0xf0; s.ssrcBuffer[1] = 0x0f
s.ivBuffer[4] = 0x11; s.ivBuffer[5] = 0x22
s.xor()
console.log('a=' + String(s.ivBuffer[4]) + ',' + String(s.ivBuffer[5]))

// identifier.<field>[expr], and a plain numeric array
s.nums[1] += 10
s.nums[0] *= 3
console.log('b=' + s.nums.join(','))

// two-level field chain
s.inner.buf[2] = 5
s.inner.buf[2] += 7
console.log('c=' + String(s.inner.buf[2]))

// the receiver's field read must happen, and the write must land on the
// SAME object -- if a copy were made, d would print the unmodified 5.
const alias = s.inner.buf
console.log('d=' + String(alias[2]))
