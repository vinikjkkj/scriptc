/* A program whose slice and join behaviour is known EXACTLY, so the census
 * can be scored against a prediction rather than merely inspected.
 *
 * PREDICTED, before running:
 *   slice calls      1150   (1000 partial + 100 whole + 50 empty)
 *   slice-src        every call src=10
 *   slice-n rows     n=3 x1000,  n=10 x100,  n=0 x50
 *   slice empty      50
 *   slice whole      100
 *   join calls       200, src=5
 *
 * If the census reports anything else, the instrument is wrong, not the
 * program. Every result is folded into a checksum and printed so that no
 * call can be optimised away as dead.
 */
const base: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const five: string[] = ['a', 'b', 'c', 'd', 'e']

let sum = 0
let chars = 0

/* 1000 partial slices: 3 elements out of 10. */
for (let i = 0; i < 1000; i++) {
  const s = base.slice(2, 5)
  sum += s.length
}

/* 100 whole-array slices: n === src, the shape a reference would replace. */
for (let i = 0; i < 100; i++) {
  const s = base.slice(0, 10)
  sum += s.length
}

/* 50 empty slices: the degenerate `n ? n : 1` allocation. */
for (let i = 0; i < 50; i++) {
  const s = base.slice(7, 7)
  sum += s.length
}

/* 200 joins of a 5-element array. */
for (let i = 0; i < 200; i++) {
  const j = five.join(',')
  chars += j.length
}

console.log('sum=' + String(sum))
console.log('chars=' + String(chars))
