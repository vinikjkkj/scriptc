// normalize() as a receiver of further string methods: the chain result
// is an ordinary string, so split, trim and toUpperCase all see its value.
function tokens(input: any): string[] {
  return input.normalize('NFKC').trim().toUpperCase().split(' ')
}
console.log(tokens('  ａｂ ①  ').join('|'))
console.log(tokens('x́ y').length)
