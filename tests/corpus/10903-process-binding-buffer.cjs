// safer-buffer's probe: process.binding('buffer') inside a try/catch. Node v24.15.0 returns the
// binding object (no throw), so kStringMaxLength is read from it.
var safer = {}
safer.kMaxLength = 4294967296
if (!safer.kStringMaxLength) {
  try {
    safer.kStringMaxLength = process.binding('buffer').kStringMaxLength
  } catch (e) {
    console.log('threw', e.message)
  }
}
if (!safer.constants) {
  safer.constants = { MAX_LENGTH: safer.kMaxLength }
  if (safer.kStringMaxLength) safer.constants.MAX_STRING_LENGTH = safer.kStringMaxLength
}
console.log(safer.kStringMaxLength, safer.constants.MAX_LENGTH, safer.constants.MAX_STRING_LENGTH)
console.log(typeof safer.kStringMaxLength, safer.kStringMaxLength > 1000)
