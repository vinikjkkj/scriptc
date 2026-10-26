// The builtin buffer module's value members, read through the module: numbers, the constants object,
// atob/btoa, isUtf8/isAscii and the INSPECT_MAX_BYTES number.
var b = require('buffer')
console.log(typeof b.kMaxLength, b.kMaxLength > 0, typeof b.kStringMaxLength, b.kStringMaxLength > 1000)
console.log(typeof b.constants, b.constants.MAX_LENGTH > 0, b.constants.MAX_STRING_LENGTH > 1000)
console.log(typeof b.atob, b.atob(b.btoa('hi there')), typeof b.btoa)
console.log(b.isUtf8(new Uint8Array([104, 105])), b.isAscii(new Uint8Array([200])), b.INSPECT_MAX_BYTES)
console.log(typeof b.Buffer, b.Buffer === Buffer, typeof b.resolveObjectURL)
