// Explicit `any[]` and `any` parameters in function types in program source
// (pg-protocol: DataRowMessage.fields, serializer valueMapper).
class Row {
  public readonly fieldCount: number;
  constructor(public length: number, public fields: any[]) {
    this.fieldCount = fields.length;
  }
}
function writeValues(values: any[], mapper: ((v: any, i: number) => string) | undefined, off: number): string {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) out += "N";
    else out += mapper ? mapper(v, i + off) : String(v);
  }
  return out;
}
const r = new Row(3, ["a", 1, null, true]);
console.log(r.fieldCount, r.fields[1], r.fields.length);
console.log(writeValues(r.fields, undefined, 0));
console.log(writeValues([1, 2, undefined], (v, i) => `${v}@${i}`, 10));

function h(mapper: ((v: any, i: number) => string) | undefined, v: number): string {
  return mapper ? mapper(v, 1) : "none";
}
console.log(h(undefined, 1), h((v, i) => `${v}@${i}`, 5));
function k(cb?: (v: any, i: number) => string): string {
  return cb ? cb(2, 1) : "none";
}
console.log(k(), k((v, i) => `${v}@${i}`));
