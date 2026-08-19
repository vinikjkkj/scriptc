/* The SILENT half of 4731, split out so it fails on base as a WRONG
 * ANSWER rather than as a build error: nothing here spells the union
 * receiver whose `.toString()` base refuses, so base COMPILES this and
 * prints "[object Object]" for every row but the last two.
 *
 * Every receiver below is a MATERIALIZED record -- a class instance in a
 * record-typed parameter, an array element, a checked cast off a dyn --
 * which is where the class pointer is gone and Object.prototype's
 * constant used to be folded over a toString that exists.
 */
type Rec = { low: number };

class L64 {
  low: number;
  constructor(low: number) {
    this.low = low;
  }
  toString(): string {
    return "L" + this.low;
  }
}

function conv(x: Rec): string {
  return String(x) + "|" + `${x}` + "|" + x.toString();
}

console.log("A " + conv(new L64(9)));

const src = { low: 7, toString: () => "seven" };
const u: unknown = src;
console.log("B " + conv(u as Rec));

const arr: Rec[] = [new L64(5), u as Rec];
console.log("C " + arr.map((x) => String(x)).join(","));

// An interface the class satisfies structurally, reached through a field
interface Box {
  readonly slot: Rec;
}
const b: Box = { slot: new L64(4) };
console.log("D " + conv(b.slot));

// The controls: a plain literal, and a class with no toString anywhere.
// "[object Object]" IS Node's answer for both, so these must not move.
console.log("E " + conv({ low: 3 }));
class Plain {
  low: number;
  constructor(low: number) {
    this.low = low;
  }
}
console.log("F " + conv(new Plain(2)));
