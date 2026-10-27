// === across the arms of one union: different arm types are never equal,
// NaN is never equal to itself, +0 equals -0, strings compare by content.
type Arm = string | number | boolean | undefined | null;
function same(a: Arm, b: Arm): boolean { return a === b; }
function diff(a: Arm, b: Arm): boolean { return a !== b; }
const vals: Arm[] = ['1', 1, true, 'true', undefined, null, 0, -0, NaN, 'abc', ''];
let grid = '';
for (const a of vals) {
  for (const b of vals) {
    grid += same(a, b) ? '1' : '0';
  }
  grid += '|';
}
console.log(grid);
console.log(same(NaN, NaN), same(0, -0), diff(0, -0), diff(NaN, NaN));
console.log(same('ab', 'a' + 'b'), same(undefined, null), same(null, null), same(true, 1), same('1', 1));
console.log(same(undefined, undefined), diff(null, undefined), same('', ''), same(1, 1.0));
