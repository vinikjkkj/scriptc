// A checked-dynamic (`any`) value as the callback of an array HOF, with and without a thisArg.
/** @type {any} */ var has = { a: 1, b: 2, c: 3 }
/** @type {any} */ var isA = function (x) { return x === 'a' }
/** @type {any} */ var withThis = function (x) { return this.keep.indexOf(x) >= 0 }
/** @type {any} */ var upper = function (x, i, arr) { return x.toUpperCase() + i + arr.length }
/** @type {any} */ var count = 0
/** @type {any} */ var tally = function (x, i, arr) { count += 1 + i + arr.length }
var keys = ['a', 'b', 'c']
console.log(keys.filter(isA), keys.filter(withThis, { keep: ['b', 'c'] }), keys.filter(has.hasOwnProperty, has))
console.log(keys.map(upper), keys.map(withThis, { keep: ['a'] }))
keys.forEach(tally)
console.log(count)
console.log(keys.some(isA), keys.every(isA), keys.find(isA), keys.findIndex(isA))
console.log([1, 2, 3].filter(/** @type {any} */ (function (n) { return n > 1 })), [true, false].map(/** @type {any} */ (function (b) { return !b })))
// The third argument is the receiver itself (a live view of it).
var seen = []
/** @type {any} */ var peek = function (x, i, arr) { seen.push(arr === arr, arr.length, arr[i] === x); return true }
keys.filter(peek)
console.log(seen.join())
/** @type {any} */ var mutate = function (x, i, arr) { if (i === 0) arr.push('z'); return true }
var ks = ['p', 'q']
console.log(ks.filter(mutate), ks)
// Not callable: Node throws before the first iteration, even over an empty array.
/** @type {any[]} */ var notFns = [undefined, null, 5, 'str', true, {}, [1, 2]]
notFns.forEach(function (f) {
  try { keys.filter(f); console.log('no throw') } catch (e) { console.log(e.constructor.name, e.message) }
  try { [].forEach(f, keys); console.log('no throw') } catch (e) { console.log(e.constructor.name, e.message) }
})
