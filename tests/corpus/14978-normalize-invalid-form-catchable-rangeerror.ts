// An invalid normalize form is a catchable RangeError with Node's message,
// and the caught value is an instance of RangeError; valid forms still answer.
function norm(s: string, form: string): string {
  try {
    return s.normalize(form)
  } catch (e) {
    return (e as Error).name + ': ' + (e as Error).message + ' ' + String((e as Error) instanceof RangeError)
  }
}
console.log(norm('é', 'NFC').length, norm('é', 'NFD').length)
console.log(norm('abc', 'nfc'))
console.log(norm('abc', ''))
console.log(norm('abc', 'NFKD'))
let n = 0
for (let i = 0; i < 2000; i++) {
  if (norm('x', i % 2 ? 'bad' : 'NFC') !== 'x') n++
}
console.log('bad-count', n)
console.log('after', norm('ﬁ', 'NFKC'))
