// `s += x` where `s` lives in a closure-captured box appends in place when nothing else holds the string, and copies otherwise. Every case below prints what
// JavaScript prints: aliases keep the value they had, the left side read BEFORE the operand runs is the one concatenated, split surrogates and Map keys
// see flat strings.
function accumulator(): { add: (x: string) => void; get: () => string; len: () => number; code: (i: number) => number } {
  let s = "";
  return {
    add: (x: string): void => {
      s += x;
    },
    get: (): string => s,
    len: (): number => s.length,
    code: (i: number): number => s.charCodeAt(i),
  };
}

// 1. a loop of appends, with a long tail so the buffer outgrows its first capacity
const acc = accumulator();
for (let i = 0; i < 3000; i++) acc.add("piece" + (i % 7) + ";");
console.log("loop", acc.len(), acc.code(0), acc.code(acc.len() - 1), acc.get().slice(0, 12), acc.get().slice(-12));

// 2. an alias taken before an append must keep its value (rc > 1: copy, never mutate)
const a2 = accumulator();
a2.add("alpha");
const before = a2.get();
a2.add("-beta");
const mid = a2.get();
a2.add("-gamma");
console.log("alias", before, mid, a2.get(), before.length, mid.length, a2.len());

// 3. the left side is later mutated by another append: the earlier snapshots stay distinct
const a3 = accumulator();
const snaps: string[] = [];
for (let i = 0; i < 6; i++) {
  a3.add("<" + i + ">");
  snaps.push(a3.get());
}
console.log("snaps", snaps.join("|"));

// 4. the operand reassigns the variable while it runs: JS concatenates the value read BEFORE the operand
let shared = "old";
const reassign = (): void => {
  shared = "REASSIGNED";
};
const operand: any = {
  toString(): string {
    reassign();
    return "+tail";
  },
};
shared += operand;
console.log("order", shared);
let shared2 = "keep";
const rewrite = (): void => {
  shared2 = "other";
};
const operand2: any = {
  toString(): string {
    rewrite();
    return "!";
  },
};
const read = (): string => shared2;
shared2 += operand2;
console.log("order2", read());

// 5. an astral character appended whole: the UTF-16 length and indices stay right after in-place appends
const a5 = accumulator();
a5.add("a");
console.log("pair0", a5.len());
a5.add("\u{1F600}");
console.log("pair1", a5.len(), a5.code(1), a5.code(2));
a5.add("x");
console.log("pair", a5.len(), a5.code(1), a5.code(2), a5.code(3), a5.get() === "a\u{1F600}x");

// 6. results used as Map keys, before and after further appends
const a6 = accumulator();
const keys = new Map<string, number>();
for (let i = 0; i < 5; i++) {
  a6.add("k" + i);
  keys.set(a6.get(), i);
}
console.log("map", keys.size, keys.get("k0"), keys.get("k0k1"), keys.get("k0k1k2k3k4"), keys.has("k0k1k2k3k4k5"), [...keys.keys()].join(","));

// 7. self-append: the accumulator as its own operand
let self = "ab";
const doubler = (): void => {
  self += self;
};
doubler();
doubler();
console.log("self", self, self.length, (() => self)());

// 8. a captured accumulator also read by length between appends (cached length must not go stale)
const a8 = accumulator();
let total = 0;
for (let i = 0; i < 200; i++) {
  a8.add("é" + i);
  total += a8.len();
}
console.log("len", total, a8.len());

// 9. mixed widths appended one by one, the cached UTF-16 length read after every append and the characters read back at the end
const a9 = accumulator();
const widths = ["a", "é", "€", "\u{1F600}", "z"];
let lens = "";
for (let i = 0; i < 40; i++) {
  a9.add(widths[i % widths.length]!);
  lens += a9.len() + ",";
}
console.log("mixed", lens);
console.log("mixed2", a9.len(), a9.code(0), a9.code(1), a9.code(2), a9.code(3), a9.code(4), a9.code(5), a9.code(39));
