// === and !== between operands of different static kinds: JavaScript
// compares the TYPES first, so the answer is false (true for !==) with no
// conversion. A boolean against a string, a number against a string, a
// bigint against a number, and the two unit values are all of that shape.
const o = { A: 1 }
const key = 'A'
if (!o[key] === 'undefined') console.log('never')
console.log(!o[key] === 'undefined', !o[key] !== 'undefined')
console.log(1 === '1', 1 !== '1', 'x' === 1, 0 === '')
console.log(1n === 1, 1n !== 1, null === undefined, undefined !== null)
console.log(true === 'true', false !== 0, typeof o === 'object')
console.log(!!o.A === 'true', !o.A === 1, !o.B === 'undefined')
