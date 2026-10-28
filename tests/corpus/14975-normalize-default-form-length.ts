// normalize() with the form omitted is NFC; the result length shows the
// composition, and an already-normalized string comes back unchanged.
const decomposed = 'café'
console.log(decomposed.length, decomposed.normalize().length, decomposed.normalize() === 'caf\u00e9' ? 'same' : 'differs')
console.log(decomposed.normalize('NFC') === decomposed.normalize(), ''.normalize().length)
console.log('plain'.normalize('NFKD'), 'aﬀ'.normalize('NFKC').length)
