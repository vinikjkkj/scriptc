// A class expression in a loop body is a fresh class each iteration.
const results: string[] = [];
let prevSame = 0;
for (let i = 0; i < 3; i++) {
  const label = "L" + i;
  const k = i * 2;
  const K = class {
    tag = label;
    v = k;
    show(): string {
      return label + "#" + k;
    }
  };
  const a = new K();
  const b = new K();
  results.push(a.show() + (a instanceof K ? "+" : "-") + (b.v === a.v ? "=" : "!"));
  prevSame += K.name === "K" ? 1 : 0;
}
console.log(results.join(" "), prevSame);
let w = 0;
const picked: Array<{ n: number }> = [];
while (w < 2) {
  const step = w * 5;
  const J = class {
    n = step;
  };
  picked.push(new J(), new J());
  w++;
}
console.log(picked.map((p) => p.n).join(","));
// Classes minted in a callback are distinct values of one type.
const made = [1, 2, 3].map((n) => {
  const label = "m" + n;
  return class {
    id(): string {
      return label;
    }
  };
});
const objs = made.map((C) => new C());
console.log(objs.map((o) => o.id()).join(" "));
console.log(made[0] === made[1], made[1] === made[1], made.length);
console.log(objs.map((o) => made.map((C) => (o instanceof C ? 1 : 0)).join("")).join("|"));
