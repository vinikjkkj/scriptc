// The other side of the engine link gate: a program that CALLS the Function constructor it reached through a prototype (directly, through a
// local, handed to a function, or stored in an object) does run text, so it still links the embedded engine and prints Node's answers.
function f() {}
const FnCtor = Object.getPrototypeOf(f).constructor
console.log(FnCtor('return 7')(), FnCtor('a', 'b', 'return a + b')(20, 22))
const stash = { make: Object.getPrototypeOf(f).constructor }
console.log(stash.make('return 11')())
function run(C, src) { return C(src)() }
console.log(run(Object.getPrototypeOf(function () {}).constructor, 'return 5'))
console.log(Object.getPrototypeOf(f).constructor('x', 'return x * 2')(21))
