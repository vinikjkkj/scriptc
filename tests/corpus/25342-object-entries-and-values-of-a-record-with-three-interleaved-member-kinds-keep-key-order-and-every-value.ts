interface BoolP { code: number; type: 'boolean'; def: boolean }
interface NumP { code: number; type: 'int'; def: number }
interface StrP { code: number; type: 'string'; def: string }
type Spec = {
  p00: BoolP;
  p01: BoolP;
  p02: NumP;
  p03: StrP;
  p04: BoolP;
  p05: BoolP;
  p06: NumP;
  p07: BoolP;
  p08: BoolP;
  p09: NumP;
  p10: BoolP;
  p11: NumP;
  p12: BoolP;
  p13: BoolP;
  p14: BoolP;
  p15: NumP;
  p16: NumP;
  p17: BoolP;
  p18: BoolP;
  p19: BoolP;
  p20: NumP;
  p21: NumP;
  p22: BoolP;
  p23: NumP;
  p24: BoolP;
  p25: BoolP;
  p26: StrP;
  p27: StrP;
  p28: NumP;
  p29: BoolP;
};
const spec: Spec = {
  p00: { code: 1, type: 'boolean', def: true },
  p01: { code: 4, type: 'boolean', def: false },
  p02: { code: 7, type: 'int', def: 14 },
  p03: { code: 10, type: 'string', def: 's3' },
  p04: { code: 13, type: 'boolean', def: true },
  p05: { code: 16, type: 'boolean', def: false },
  p06: { code: 19, type: 'int', def: 42 },
  p07: { code: 22, type: 'boolean', def: false },
  p08: { code: 25, type: 'boolean', def: true },
  p09: { code: 28, type: 'int', def: 63 },
  p10: { code: 31, type: 'boolean', def: true },
  p11: { code: 34, type: 'int', def: 77 },
  p12: { code: 37, type: 'boolean', def: true },
  p13: { code: 40, type: 'boolean', def: false },
  p14: { code: 43, type: 'boolean', def: true },
  p15: { code: 46, type: 'int', def: 105 },
  p16: { code: 49, type: 'int', def: 112 },
  p17: { code: 52, type: 'boolean', def: false },
  p18: { code: 55, type: 'boolean', def: true },
  p19: { code: 58, type: 'boolean', def: false },
  p20: { code: 61, type: 'int', def: 140 },
  p21: { code: 64, type: 'int', def: 147 },
  p22: { code: 67, type: 'boolean', def: true },
  p23: { code: 70, type: 'int', def: 161 },
  p24: { code: 73, type: 'boolean', def: true },
  p25: { code: 76, type: 'boolean', def: false },
  p26: { code: 79, type: 'string', def: 's26' },
  p27: { code: 82, type: 'string', def: 's27' },
  p28: { code: 85, type: 'int', def: 196 },
  p29: { code: 88, type: 'boolean', def: false },
};
function line(v: BoolP | NumP | StrP): string { return v.code + ':' + v.type + '=' + String(v.def); }
const e = Object.entries(spec);
console.log(e.length);
for (const [k, v] of e) console.log(k, line(v));
console.log(Object.values(spec).map(line).join(' '));
console.log(Object.keys(spec).join(','));
console.log(JSON.stringify(spec).length);
