interface Cell { code: number; label: string }
function mk(i: number): Cell { return { code: i * 7 + 2, label: 'cell' + i }; }
type Wide = {
  c0: Cell;
  c1?: Cell;
  c2: Cell;
  c3: Cell;
  c4?: Cell;
  c5: Cell;
  c6: Cell;
  c7?: Cell;
  c8: Cell;
  c9: Cell;
  c10?: Cell;
  c11: Cell;
  c12: Cell;
  c13?: Cell;
  c14: Cell;
  c15: Cell;
  c16?: Cell;
  c17: Cell;
  c18: Cell;
  c19?: Cell;
  c20: Cell;
  c21: Cell;
  c22?: Cell;
  c23: Cell;
};
type Dense = {
  d0: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
  d5: number;
  d6: number;
  d7: number;
  d8: number;
  d9: number;
  d10: number;
  d11: number;
  d12: number;
  d13: number;
  d14: number;
  d15: number;
  d16: number;
  d17: number;
  d18: number;
  d19: number;
  d20: number;
  d21: number;
  d22: number;
  d23: number;
};
function show(w: Wide): string {
  const e = Object.entries(w); let s = e.length + ':';
  for (const [k, v] of e) s += ' ' + k + '=' + v.code + '/' + v.label;
  const vs = Object.values(w); s += ' | ' + vs.length + ' ' + vs.map((v) => v.code).join(',');
  return s;
}
const full: Wide = {
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
};
console.log(show(full));
const base = JSON.stringify(full);
function through(x: unknown): Wide { return x as Wide; }
for (const drop of [1, 4, 7, 22, 10, 19]) { const d = JSON.parse(base); delete d['c' + drop]; console.log(drop, show(through(d))); }
const d2 = JSON.parse(base); delete d2.c1; delete d2.c4; delete d2.c10; delete d2.c13; delete d2.c19; console.log(show(through(d2)));
const dense: Dense = {
  d0: 1,
  d1: 2,
  d2: 5,
  d3: 10,
  d4: 17,
  d5: 26,
  d6: 37,
  d7: 50,
  d8: 65,
  d9: 82,
  d10: 101,
  d11: 122,
  d12: 145,
  d13: 170,
  d14: 197,
  d15: 226,
  d16: 257,
  d17: 290,
  d18: 325,
  d19: 362,
  d20: 401,
  d21: 442,
  d22: 485,
  d23: 530,
};
console.log(Object.entries(dense).map(([k, v]) => k + v).join(' '));
console.log(Object.values(dense).reduce((a, b) => a + b, 0));
const wide: Record<string, number> = dense;
console.log(Object.keys(wide).length, Object.entries(wide).slice(-3).map(([k, v]) => k + v).join(";"));
type Opt = {
  o0?: Cell;
  o1?: Cell;
  o2?: Cell;
  o3?: Cell;
  o4?: Cell;
  o5?: Cell;
  o6?: Cell;
  o7?: Cell;
  o8?: Cell;
  o9?: Cell;
  o10?: Cell;
  o11?: Cell;
};
function showOpt(o: Opt): string { let s = ''; for (const [k, v] of Object.entries(o)) s += k + '=' + v.code + ' '; return s + Object.values(o).length; }
const optFull: Opt = {
  o0: mk(0),
  o1: mk(1),
  o2: mk(2),
  o3: mk(3),
  o4: mk(4),
  o5: mk(5),
  o6: mk(6),
  o7: mk(7),
  o8: mk(8),
  o9: mk(9),
  o10: mk(10),
  o11: mk(11),
};
console.log(showOpt(optFull));
const ob = JSON.stringify(optFull);
for (const drop of [0, 5, 11]) { const d = JSON.parse(ob); delete d['o' + drop]; console.log(drop, showOpt(through2(d))); }
const dall = JSON.parse(ob); for (let i = 0; i < 12; i++) delete dall['o' + i]; console.log('[' + showOpt(through2(dall)) + ']');
function through2(x: unknown): Opt { return x as Opt; }
