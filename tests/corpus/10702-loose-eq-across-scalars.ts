// == and != over untyped operands of every scalar kind: the runtime owns
// IsLooselyEqual (number/string/boolean/null/undefined/NaN), so each pair
// answers what JavaScript answers.
const one: any = 1
const str1: any = '1'
const zero: any = 0
const empty: any = ''
const no: any = false
const nan: any = NaN
const nothing: any = undefined
const nul: any = null
console.log(one == str1, one != str1, zero == empty, no == empty)
console.log(no == zero, true == one, str1 == true, nan == nan, nan != nan)
console.log(nothing == nul, nul == zero, nothing == zero, nul == nul, nothing != nul)
console.log(' 12 ' == (12 as any), '0x10' == (16 as any), '1e2' == (100 as any))
