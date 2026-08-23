// OrdinaryOwnPropertyKeys over an object with TWO key sources: the class's
// declared fields and the run-time property table.
//
// WHY THIS PROGRAM EXISTS: every ARRAY-INDEX key sorts ahead of every
// string key ACROSS THE WHOLE OBJECT, so a table holding "2" and "10"
// prints BEFORE a field the constructor assigned. Emitting the table's
// entries in one block after the fields gave
// `C { a: 1, '2': ..., '10': ... }` where Node gives
// `C { '2': ..., '10': ..., a: 1, ... }` -- the right keys in the wrong
// order, which is a WRONG answer and not a partial one.
//
// The index test is the spec's, not "looks numeric": "01", "-1", "1.5" and
// "4294967295" are ordinary string keys and hold their insertion slot.
class C {
  a: number
  b: string
  constructor() { this.a = 1; this.b = 'x' }
}

const c = new C()
const keys = ['z', '10', '2', 'y', '01', '-1', '1.5', '4294967294', '4294967295']
for (let i = 0; i < keys.length; i += 1) {
  Object.defineProperty(c, keys[i], { value: i, enumerable: true, writable: true, configurable: true })
}
console.log(c)

// Insertion order for the string half, with no index keys in play at all.
const d = new C()
const plain = ['q', 'b2', 'm', 'aa']
for (let i = 0; i < plain.length; i += 1) {
  Object.defineProperty(d, plain[i], { value: plain[i], enumerable: true, writable: true, configurable: true })
}
console.log(d)
for (let i = 0; i < plain.length; i += 1) {
  console.log(plain[i] + ' ' + String(plain[i] in d))
}
