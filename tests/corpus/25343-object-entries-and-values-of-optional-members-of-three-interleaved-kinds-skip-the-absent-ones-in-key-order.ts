interface BoolP { code: number; type: 'boolean'; def: boolean }
interface NumP { code: number; type: 'int'; def: number }
interface StrP { code: number; type: 'string'; def: string }
type Opt = {
  o00?: BoolP;
  o01?: BoolP;
  o02?: BoolP;
  o03?: NumP;
  o04?: NumP;
  o05?: BoolP;
  o06?: NumP;
  o07?: BoolP;
  o08?: BoolP;
  o09?: StrP;
  o10?: NumP;
  o11?: BoolP;
  o12?: BoolP;
  o13?: BoolP;
  o14?: BoolP;
  o15?: NumP;
  o16?: BoolP;
  o17?: BoolP;
  o18?: BoolP;
  o19?: BoolP;
  o20?: NumP;
  o21?: NumP;
  o22?: BoolP;
  o23?: BoolP;
  o24?: StrP;
  o25?: BoolP;
  o26?: NumP;
  o27?: NumP;
};
const full: Opt = {
  o00: { code: 1, type: 'boolean', def: true },
  o01: { code: 4, type: 'boolean', def: false },
  o02: { code: 7, type: 'boolean', def: true },
  o03: { code: 10, type: 'int', def: 21 },
  o04: { code: 13, type: 'int', def: 28 },
  o05: { code: 16, type: 'boolean', def: false },
  o06: { code: 19, type: 'int', def: 42 },
  o07: { code: 22, type: 'boolean', def: false },
  o08: { code: 25, type: 'boolean', def: true },
  o09: { code: 28, type: 'string', def: 's9' },
  o10: { code: 31, type: 'int', def: 70 },
  o11: { code: 34, type: 'boolean', def: false },
  o12: { code: 37, type: 'boolean', def: true },
  o13: { code: 40, type: 'boolean', def: false },
  o14: { code: 43, type: 'boolean', def: true },
  o15: { code: 46, type: 'int', def: 105 },
  o16: { code: 49, type: 'boolean', def: true },
  o17: { code: 52, type: 'boolean', def: false },
  o18: { code: 55, type: 'boolean', def: true },
  o19: { code: 58, type: 'boolean', def: false },
  o20: { code: 61, type: 'int', def: 140 },
  o21: { code: 64, type: 'int', def: 147 },
  o22: { code: 67, type: 'boolean', def: true },
  o23: { code: 70, type: 'boolean', def: false },
  o24: { code: 73, type: 'string', def: 's24' },
  o25: { code: 76, type: 'boolean', def: false },
  o26: { code: 79, type: 'int', def: 182 },
  o27: { code: 82, type: 'int', def: 189 },
};
function line(v: BoolP | NumP | StrP | undefined): string { return v === undefined ? '-' : v.code + ':' + v.type + '=' + String(v.def); }
function show(o: Opt): string { let s = Object.keys(o).length + ':'; for (const [k, v] of Object.entries(o)) s += ' ' + k + '=' + line(v); return s + ' | ' + Object.values(o).map(line).join(','); }
function through(x: unknown): Opt { return x as Opt; }
console.log(show(full));
const base = JSON.stringify(full);
for (const drop of [0, 3, 4, 9, 13, 14, 20, 27]) { const d = JSON.parse(base); delete d['o' + String(drop).padStart(2, '0')]; console.log(drop, show(through(d))); }
const d2 = JSON.parse(base); for (const i of [1, 2, 5, 6, 7, 8, 10, 11, 12, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26]) delete d2['o' + String(i).padStart(2, '0')]; console.log(show(through(d2)));
const d3 = JSON.parse(base); for (let i = 0; i < 28; i++) delete d3['o' + String(i).padStart(2, '0')]; console.log('[' + show(through(d3)) + ']');
