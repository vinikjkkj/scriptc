// @ts-nocheck
// The charset-table shape: pairs destructured from an array literal. The
// destructured `start` is a number-or-string arm at the type level, so the
// loop's ++ and the relational test over it run through the runtime's
// ToNumeric and IsLessThan, and `start + 1` is the operator's own conversion.
const blocks = [[2048, 'cesu8'], [2304, 'utf8']]
const seen = []
for (const [start, encoding] of blocks) {
  let id = start
  for (let k = 0; k < 3; k++) {
    id++
    seen.push(encoding + ':' + id)
  }
  console.log(start < 3000, start > 3000, start + 1, id < start + 4)
}
console.log(seen.join(','))
