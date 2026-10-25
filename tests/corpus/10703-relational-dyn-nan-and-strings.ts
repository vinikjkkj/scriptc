// Abstract relational comparison on untyped operands: NaN answers false
// for every operator, two strings compare as strings (code points), and a
// string against a number compares as numbers.
const nan: any = NaN
const a: any = 'a'
const b: any = 'b'
const ten: any = '10'
const nine: any = '9'
const n9: any = 9
const t: any = true
const u: any = undefined
const nl: any = null
console.log(nan < 1, nan <= 1, nan > 1, nan >= 1, nan < nan)
console.log(a < b, b <= a, a >= 'a', ten < nine, ten < n9, ten > n9)
console.log(a < 1, a > 0, a >= 1, t < 2, t > 0, u < 1, u >= 0, nl >= 0, nl < 1)
console.log(ten < 9, '10' < (9 as any), (2 as any) < 'x', (-1 as any) < '0')
function bucket(v: any): number { return v < 'm' ? 1 : v <= 5 ? 2 : 3 }
console.log(bucket('apple'), bucket('zebra'), bucket(4), bucket(NaN), bucket('10'))
