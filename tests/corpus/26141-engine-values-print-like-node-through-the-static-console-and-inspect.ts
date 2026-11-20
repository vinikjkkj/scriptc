// Objects built by new Function text print exactly as Node prints them: through console.log, a nested static holder, util.inspect and %-formats.
import { inspect } from "node:util";
const mk: any = new Function(`
  const o = {};
  for (let i = 0; i < 9; i++) o["key" + i] = "value" + i;
  class Pt { constructor() { this.x = 1; this.y = [1,2,3]; } get g() { return 5; } }
  const circ = { name: "c" }; circ.self = circ;
  return {
    wide: o,
    nums: Array.from({ length: 30 }, (_, i) => i * 3),
    inst: new Pt(),
    map: new Map([["a", 1], ["b", { z: 1 }]]),
    set: new Set([1, 2, 3]),
    date: new Date(0),
    fn: function named(a, b) { return a + b; },
    arrow: (x) => x,
    sym: Symbol("s"),
    circ,
    str: "a'b\\"c\\n",
    nested: [[1, [2, [3, [4]]]]],
    undef: undefined,
    nul: null,
    neg0: -0,
    big: 12345678901234567890n,
    typed: new Uint8Array([1, 2, 3]),
    re: /ab+c/gi,
    longstr: "x".repeat(200),
  };
`);
const o = mk();
console.log(o);
console.log(o.wide);
console.log(o.nums);
console.log(o.map, o.set, o.date, o.fn, o.arrow, o.inst);
console.log({ holder: o.inst, list: [o.set, o.map] });
console.log(inspect(o.wide), inspect(o.nested, { depth: 0 }));
console.error(o.set);
console.log("%s|%d|%j|%O", "s", 5, o.set, o.nested);
