// Spread fences — what stays out and why: spreads into FIXED parameter
// positions (arity must complete at compile time), non-identifier object
// spread sources (a conditional spread has no fixed shape), a spread copy
// that OVERWRITES an explicit property whose evaluation is observable, and
// spreading anything but a same-element-type (or element-LIFTABLE —
// string[] into (string | number)[] wraps per element now) array.
//
// A spread merely FOLLOWING explicit properties is fine: the copies append
// after them, which is JS's own order. tsc rejects the overwrite outright
// (TS2783) for required source fields, so only OPTIONAL ones get here.

function two(a: number, b: number): number {
  return a + b;
}
const pair: number[] = [1, 2];
console.log(two(...(pair as [number, number])));

interface Shape {
  x: number;
  y: number;
}
declare function pick(): Shape;
const cond = true;
const s1: Shape = { ...(cond ? { x: 1, y: 2 } : { x: 3, y: 4 }) };
interface YOnly {
  y: number;
}
const yPart: YOnly = { y: 0 };
const s2: Shape = { x: 5, ...yPart };
console.log(s2.x + s2.y);

interface OptXY {
  x?: number;
  y?: number;
}
let ticks = 0;
function bump(): number {
  ticks += 1;
  return ticks;
}
const part: OptXY = { x: 9 };
const s3: OptXY = { x: bump(), ...part };
console.log(s3.x ?? -1, ticks);

// A spread field the target keeps (no later override) must match exactly —
// and the diagnostic shows the SOURCE shape, where the difference lives
// (the literal's own type would already have overrides applied and could
// print identically to the target).
interface OptSrc {
  s?: string;
  n: number;
}
interface ReqDst {
  s: string;
  n: number;
}
const optSrc: OptSrc = { n: 1 };
const reqDst = { ...optSrc } as ReqDst;
console.log(reqDst.n);
