// The only mention of SEEN is inside a function nobody calls: that is a read as far as the compiler can prove, so SEEN is built exactly as before.
const BASE: number[] = [1, 2, 3];
export const SEEN = BASE.map((n) => n * 3);
function neverCalled(): number {
  return SEEN.length;
}
export const OTHER = BASE.filter((n) => n > 1);
console.log(typeof neverCalled, OTHER.length, BASE.length);
