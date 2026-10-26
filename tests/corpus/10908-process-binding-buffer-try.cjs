// safer-buffer's probe shape: process.binding('buffer') read inside try/catch, the value stored
// into a plain object and used. Node v24.15.0 has the binding, so the catch branch is not taken.
var sk = {}
try {
  sk.kStringMaxLength = process.binding('buffer').kStringMaxLength
} catch (e) {
  console.log('threw', e.message)
}
if (!sk.constants) {
  sk.constants = { MAX_LENGTH: 4294967296 }
  if (sk.kStringMaxLength) sk.constants.MAX_STRING_LENGTH = sk.kStringMaxLength
}
console.log(typeof sk.kStringMaxLength, sk.kStringMaxLength > 1000, sk.constants.MAX_STRING_LENGTH === sk.kStringMaxLength)
