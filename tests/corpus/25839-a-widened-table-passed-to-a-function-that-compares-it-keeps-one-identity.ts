// The riskiest kind on the identity-blind list is `call`: the record is only passed, and the identity use (a comparison) sits in the callee. The source table
// and its widened name are one object in Node, so the callee sees them equal. The callee's comparison is a node with a record operand of the pair's shape, which
// keeps the view. With the identity census switched off (SCRIPTC_RECORD_WIDTH_MUTANT=ignoreidentity) the cast becomes a copy and the comparison answers false.
interface Entry { readonly code: number; readonly flag: boolean | number }
const TABLE = Object.freeze({
  alpha: Object.freeze({ code: 1, flag: true }),
  beta: Object.freeze({ code: 2, flag: 0 }),
})
type Name = keyof typeof TABLE
type Wide = Readonly<Record<Name, Entry>>
const WIDE = TABLE as Wide
function sameTable(a: Wide, b: Wide): boolean { return a === b }
console.log(sameTable(TABLE, WIDE), sameTable(WIDE, WIDE), WIDE.beta.flag)
