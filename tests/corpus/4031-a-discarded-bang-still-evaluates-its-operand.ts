// Statement-position `!e` throws its boolean away, so the operand's own
// evaluation is the whole of what the program can observe -- which is why
// the minifier's function-expression forcer (`!function(){...}()`, the
// first byte of every UMD wrapper) has to compile even when the operand
// has no ToBoolean of its own. A bigint is that operand here: a VALUE
// position still fences it (there is no boolean for a bigint to become),
// and statement position never needed one.
let calls = 0
function bump(): bigint {
    calls++
    return 1n
}

!bump()
console.log("one", calls)

// Nesting is the same rule twice: the inner `!` is itself discarded.
!!bump()
console.log("double", calls)

for (let i = 0; i < 3; i++) {
    !bump()
}
console.log("loop", calls)

// The for-loop UPDATE slot is statement position too (it shares the
// lowering), and it runs once per iteration -- twice here, not three
// times, because the update follows the body.
for (let i = 0; i < 2; !bump()) {
    i++
}
console.log("update", calls)

// Parenthesized: statement position unwraps parens first, so this is the
// same rule again and not a second one.
;(!bump())
console.log("paren", calls)
