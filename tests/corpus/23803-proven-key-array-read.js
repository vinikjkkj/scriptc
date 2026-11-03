// `matches[position]` where position comes out of a table of integer literals: a dyn key whose value set is
// numbers and undefined. A number reads the element (or undefined past the end, in a hole, or for a capture
// that did not participate); a name the table lacks reads undefined.
var RE = /(\d+)(?:x(\d+))?(?:y(\d*))?/
var T = { whole: 0, first: 1, second: 2, third: 3, beyond: 9, last: 3 }
function read(subject, name) {
  var matches = RE.exec(subject)
  var position = T[name]
  var value = /** @type {any} */ (matches[position])
  return value
}
var subjects = ['12', '12x34', '12y', '12x34y56', '12xy', '7y9']
var names = Object.keys(T).concat(['toString', 'constructor', 'nope', '__proto__', 'hasOwnProperty', 'length', 'index'])
subjects.forEach(function (s) {
  console.log(s, names.map(function (n) {
    var v = read(s, n)
    return n + ':' + typeof v + ':' + (typeof v === 'string' ? JSON.stringify(v) : String(v))
  }).join(' '))
})
// No match: the receiver is null.
names.slice(0, 3).concat(['nope']).forEach(function (n) {
  try { console.log(read('zzz', n)) } catch (e) { console.log(n, e.constructor.name, e.message) }
})
// Typed arrays with holes and a short row.
function readArr(arr, name) {
  var position = T[name]
  return /** @type {any} */ (arr[position])
}
/** @type {string[]} */ var holey = new Array(5)
holey[1] = 'one'
holey[3] = 'three'
/** @type {number[]} */ var nums = new Array(4)
nums[2] = 7
nums[0] = 0
var all = Object.keys(T).concat(['nope', 'toString'])
all.forEach(function (n) {
  var a = readArr(holey, n), b = readArr(nums, n)
  console.log(n, typeof a, String(a), typeof b, String(b))
})
