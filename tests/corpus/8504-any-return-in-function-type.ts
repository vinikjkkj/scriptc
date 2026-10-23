// A function type that spells `any` as its return (pg-protocol's ValueMapper).
type ValueMapper = (param: any, index: number) => any;
function w(values: any[], mapper: ValueMapper | undefined): string {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    const v = mapper ? mapper(values[i], i) : values[i];
    if (v == null) out += "-";
    else if (typeof v === "string") out += v;
    else out += "#";
  }
  return out;
}
console.log(w([1, "a", null], undefined), w([1, "a", null], (p, i) => (p === 1 ? "one" + i : p)));
