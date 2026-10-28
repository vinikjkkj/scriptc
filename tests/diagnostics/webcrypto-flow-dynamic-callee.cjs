// A WebCrypto value passed to a dynamic callee: obj is any, so its uses are not visible.
const obj = JSON.parse('{}')
obj.run(require('crypto').webcrypto.subtle)
