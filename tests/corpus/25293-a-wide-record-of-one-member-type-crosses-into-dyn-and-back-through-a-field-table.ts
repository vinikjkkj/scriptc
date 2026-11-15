// A record of 40 members of ONE member type crosses into a dynamic slot and back (the to-dyn converter and the dynCheck builder), and is walked by
// Object.entries. The converter and the builder emit one loop over a table of the members instead of 40 blocks; the answers must be the unrolled ones:
// every key in declaration order and every value, including after a round trip through JSON that arms the own-key mask.
interface Cell { code: number; label: string; on: boolean }
function mk(i: number): Cell { return { code: i * 3 + 1, label: 'cell' + i, on: i % 3 === 0 }; }
type Wide = {
  c0: Cell;
  c1: Cell;
  c2: Cell;
  c3: Cell;
  c4: Cell;
  c5: Cell;
  c6: Cell;
  c7: Cell;
  c8: Cell;
  c9: Cell;
  c10: Cell;
  c11: Cell;
  c12: Cell;
  c13: Cell;
  c14: Cell;
  c15: Cell;
  c16: Cell;
  c17: Cell;
  c18: Cell;
  c19: Cell;
  c20: Cell;
  c21: Cell;
  c22: Cell;
  c23: Cell;
  c24: Cell;
  c25: Cell;
  c26: Cell;
  c27: Cell;
  c28: Cell;
  c29: Cell;
  c30: Cell;
  c31: Cell;
  c32: Cell;
  c33: Cell;
  c34: Cell;
  c35: Cell;
  c36: Cell;
  c37: Cell;
  c38: Cell;
  c39: Cell;
};
const wide: Wide = {
  c0: mk(0),
  c1: mk(1),
  c2: mk(2),
  c3: mk(3),
  c4: mk(4),
  c5: mk(5),
  c6: mk(6),
  c7: mk(7),
  c8: mk(8),
  c9: mk(9),
  c10: mk(10),
  c11: mk(11),
  c12: mk(12),
  c13: mk(13),
  c14: mk(14),
  c15: mk(15),
  c16: mk(16),
  c17: mk(17),
  c18: mk(18),
  c19: mk(19),
  c20: mk(20),
  c21: mk(21),
  c22: mk(22),
  c23: mk(23),
  c24: mk(24),
  c25: mk(25),
  c26: mk(26),
  c27: mk(27),
  c28: mk(28),
  c29: mk(29),
  c30: mk(30),
  c31: mk(31),
  c32: mk(32),
  c33: mk(33),
  c34: mk(34),
  c35: mk(35),
  c36: mk(36),
  c37: mk(37),
  c38: mk(38),
  c39: mk(39),
};
function through(x: unknown): unknown { return x; }
const u = through(wide);
console.log(JSON.stringify(u).length, Object.keys(u as object).length, Object.keys(u as object).slice(0, 3).join(','), Object.keys(u as object).slice(-2).join(','));
const back = u as Wide;
console.log(back.c0.code, back.c7.code, back.c20.label, back.c39.label, back.c20.on, back.c21.on);
const parsed = JSON.parse(JSON.stringify(wide)) as Wide;
const again: unknown = parsed;
console.log(JSON.stringify(again) === JSON.stringify(wide), Object.keys(again as object).join(',') === Object.keys(wide).join(','));
let total = 0; let keys = '';
for (const [k, v] of Object.entries(wide)) { total += v.code; keys += k.length; }
console.log(total, keys);
