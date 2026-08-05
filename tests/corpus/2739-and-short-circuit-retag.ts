// `a && b` where the checker types the result as ANOTHER union: for `&&`
// the TRUTHY arms of the left are dropped from that result (`Comms | null`
// on the left of `&& …` gives `boolean | null` — the `Comms` arm can never
// BE the result), so the left cannot be retagged into it before the test.
// The exact mirror of `||`'s orDefault: single-eval, retag on the FALSY
// side, where the dropped arms are unreachable by construction.

class Comms {
  public connected: boolean;
  public tag: string;
  public constructor(connected: boolean, tag: string) {
    this.connected = connected;
    this.tag = tag;
  }
  public state(): boolean {
    return this.connected;
  }
}

const live = new Comms(true, "live");
const dead = new Comms(false, "dead");

// The `!!( … )` spelling and the BOUND spelling — the two shapes the
// `obj && obj.m()` idiom takes in real code.
function isConnected(c: Comms | null): boolean {
  return !!(c && c.state());
}
function hasError(c: Comms | undefined): boolean {
  const flag = c && c.state();
  return !flag;
}
console.log(isConnected(null), isConnected(live), isConnected(dead));
console.log(hasError(undefined), hasError(live), hasError(dead));

// The falsy left is the RESULT, and it carries a ref-counted payload: `""`
// is the string arm, handed to the retag helper (which consumes the box).
function len(s: string | undefined): string | number | undefined {
  return s && s.length;
}
console.log(len(undefined) === undefined, len("") === "", len("abcd"));

// The left evaluates exactly ONCE and the right stays lazy.
let reads = 0;
function read(): Comms | null {
  reads++;
  return null;
}
let rights = 0;
function rightSide(): boolean {
  rights++;
  return true;
}
const lazy: boolean | null = read() && rightSide();
console.log(reads, rights, lazy);
function readLive(): Comms | null {
  reads++;
  return live;
}
const taken: boolean | null = readLive() && rightSide();
console.log(reads, rights, taken);

// Chained: each link retags into the same result union.
const maybe: Comms | null = reads > 0 ? null : live;
const chain: boolean | null = maybe && maybe.state();
console.log(chain);

// Refcount: the falsy side hands the box to the helper (which consumes
// it), the truthy side releases it — thousands of each, alternating.
let seen = 0;
for (let i = 0; i < 2000; i++) {
  const c: Comms | null = i % 2 === 0 ? null : new Comms(i % 4 === 1, `t${i}`);
  const r: boolean | null = c && c.state();
  if (r === null) {
    seen += 1;
  } else if (r) {
    seen += 2;
  }
}
console.log(seen);
