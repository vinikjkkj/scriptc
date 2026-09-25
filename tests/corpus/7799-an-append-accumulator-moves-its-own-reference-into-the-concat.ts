// RC / aliasing hazards around the `s += x` accumulator move. Every arm
// prints, so a differential run scores it; under SCR_RC_AUDIT a leak or a
// double release is a nonzero live-string count at exit.

function boom(): string { throw new Error("boom"); }

// 1. the operand THROWS after the accumulator has grown: the binding must
//    still hold its old value and must be released exactly once.
function throwsMidAccum(): string {
  let s = "";
  try {
    for (let i = 0; i < 6; i++) {
      s += "ab";
      if (i === 3) s += boom();
    }
  } catch (e) {
    return s + "|caught:" + (e as Error).message;
  }
  return s + "|no-throw";
}

// 2. self-concat: a == b must take the copy path.
function selfConcat(): string {
  let s = "ab";
  for (let i = 0; i < 4; i++) s = s + s;
  return s;
}

// 3. the operand READS the accumulator (rc == 2 at the call).
function readsSelf(): string {
  let s = "x";
  for (let i = 0; i < 5; i++) s += s.length > 3 ? s.slice(0, 2) : "q";
  return s;
}

// 4. a CAPTURED (boxed) accumulator: must take the old path and stay right.
function boxedAccum(): string {
  let s = "";
  const add = (x: string): void => { s += x; };
  for (let i = 0; i < 5; i++) add("cd");
  return s;
}

// 5. the accumulator is a PARAMETER (callee-owned).
function paramAccum(s: string, n: number): string {
  for (let i = 0; i < n; i++) s += "ef";
  return s;
}

// 6. break / continue out of the loop that accumulates.
function jumps(): string {
  let s = "";
  for (let i = 0; i < 20; i++) {
    if (i % 3 === 0) continue;
    s += String(i);
    if (s.length > 12) break;
  }
  return s;
}

// 7. an accumulator ALIASED into an array before the next append: the
//    array holds a reference, so rc > 1 and the copy path must be taken —
//    if it were not, the stored element would mutate underneath.
function aliasedAccum(): string {
  let s = "";
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    s += "gh";
    seen.push(s);
  }
  return seen.join(",") + "|" + s;
}

// 8. interning band: results in [16,128] bytes can come back from the
//    intern table, which is a SHARED reference — appending to one must not
//    disturb the other.
function internBand(): string {
  let a = "";
  let b = "";
  for (let i = 0; i < 12; i++) a += "ij";
  for (let i = 0; i < 12; i++) b += "ij";
  const both = a === b;
  a += "K";
  return a + "|" + b + "|" + both + "|" + (a === b);
}

// 9. the accumulator escapes into a closure AFTER the loop.
function escapesAfter(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += "mn";
  const keep = s;
  s += "OP";
  return keep + "|" + s;
}

console.log("1", throwsMidAccum());
console.log("2", selfConcat().length, selfConcat().slice(0, 6));
console.log("3", readsSelf());
console.log("4", boxedAccum());
console.log("5", paramAccum("seed", 4));
console.log("6", jumps());
console.log("7", aliasedAccum());
console.log("8", internBand());
console.log("9", escapesAfter());
