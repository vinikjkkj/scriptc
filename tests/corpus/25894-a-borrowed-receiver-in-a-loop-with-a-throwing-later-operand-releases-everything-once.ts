// The receiver of a string/array read is borrowed; a later operand that throws must leave the local intact and nothing double-freed, over thousands of iterations that would show a leak or a use after free.
function boomS(i: number): string { throw new RangeError("t" + i); }
function boomN(i: number): number { throw new TypeError("a" + i); }
function oneRound(i: number): number {
  const s = "item-" + i + "-" + (i * 31);
  const arr = [s, s + "x", s + "yy"];
  let r = 0;
  try {
    r += s.indexOf(i % 3 === 0 ? boomS(i) : "-");
  } catch (e) {
    r += (e as Error).message.length + s.length;
  }
  try {
    r += arr[i % 3 === 1 ? boomN(i) : 1]!.length;
  } catch (e) {
    r += arr.length * 7;
  }
  return r + s.charCodeAt(2) + arr.length;
}
let total = 0;
for (let i = 0; i < 6000; i++) total += oneRound(i);
console.log(total);
