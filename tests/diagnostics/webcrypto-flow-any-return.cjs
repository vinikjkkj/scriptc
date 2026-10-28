// A WebCrypto value returned through a function annotated to return any.
/** @returns {any} */
function get() {
  return require('crypto').webcrypto.subtle
}
console.log(get())
