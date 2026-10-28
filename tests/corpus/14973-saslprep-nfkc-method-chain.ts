// SASLprep's byte-changing steps: non-ASCII spaces map to U+0020, the
// commonly-mapped-to-nothing set is removed, then NFKC. The chain runs
// over an untyped (any) password on purpose.
function saslprep(password: any): string {
  const nonAsciiSpace = /[   -​  　]/g
  const mappedToNothing = /[­͏᠆᠋᠌᠍‌‍⁠︀-️﻿]/g
  return password.replace(nonAsciiSpace, ' ').replace(mappedToNothing, '').normalize('NFKC')
}
console.log(JSON.stringify(saslprep('a b')))
console.log(JSON.stringify(saslprep('pa­ss‍word')))
console.log(JSON.stringify(saslprep('Ⅷ ﬁle')))
console.log(JSON.stringify(saslprep('plain-ascii')))
