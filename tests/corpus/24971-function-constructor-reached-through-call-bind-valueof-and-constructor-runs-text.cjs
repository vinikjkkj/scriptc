// The other side of the gate for a constructor read that is the receiver of a call: `call`, `apply`, `bind`, `constructor` and a `valueOf` that
// hands the same value back all reach the Function constructor's behavior, so a program using them still links the embedded engine and prints
// Node's answers.
function f() {}
const FnCtor = Object.getPrototypeOf(f).constructor
console.log(FnCtor.call(null, 'return 1')())
console.log(FnCtor.apply(null, ['a', 'return a + 1'])(41))
console.log(FnCtor.bind(null, 'return 3')()())
console.log(FnCtor.constructor('return 4')())
console.log(FnCtor.valueOf()('return 5')())
