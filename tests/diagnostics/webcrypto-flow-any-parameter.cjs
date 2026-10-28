// A WebCrypto value bound to an any-typed parameter (untyped in JavaScript).
function take(x) {
  return 1
}
console.log(take(require('crypto').webcrypto.subtle))
