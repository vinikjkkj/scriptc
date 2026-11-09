// A dyn object's key lookup compares an entry's key with the asked key. Keys of every length from 1 to 20 are built at run time, and for
// every position in each, a second key that differs from the first in that one byte only is looked up, written, read back and deleted:
// the two must stay two distinct properties. Position 0 (first byte only), the last, and every middle byte are covered, as are the
// lengths 1-3, 4-7, 8-16 and above 16 that the comparison treats differently.
function key(n: number, pos: number, flip: boolean): string {
  let s = ''
  for (let i = 0; i < n; i++) s += i === pos && flip ? 'b' : 'a'
  return s
}
let checks = 0
let bad = 0
const lines: string[] = []
for (let n = 1; n <= 20; n++) {
  let ok = 0
  for (let pos = 0; pos < n; pos++) {
    const a = key(n, pos, false)
    const b = key(n, pos, true)
    const o: any = {}
    o[a] = 1
    checks++
    if (o[b] !== undefined) bad++
    if (o[a] !== 1) bad++
    o[b] = 2
    checks++
    if (o[a] !== 1 || o[b] !== 2) bad++
    if (Object.keys(o).length !== 2) bad++
    delete o[a]
    checks++
    if (o[a] !== undefined || o[b] !== 2) bad++
    ok++
  }
  lines.push('length ' + n + ': ' + ok + ' positions')
}
lines.push('checks ' + checks + ' bad ' + bad)
console.log(lines.join('\n'))
