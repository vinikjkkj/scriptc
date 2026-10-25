// The operands of a cross-kind === still evaluate, left then right, once
// each: the answer is a constant but the calls are not dropped.
let n = 0
const tick = (v) => { n++; console.log('tick', n, typeof v); return v }
console.log(tick(1) === tick('1'), n)
console.log(tick('a') !== tick(0), n)
console.log(tick(!0) === tick('true'), n)
console.log(tick(2n) === tick('2'), n)
let m = 0
const pick = () => { m++; return m % 2 === 0 ? 'x' : 0 }
console.log(pick() === pick(), m)
