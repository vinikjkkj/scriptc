// A function expression bound to a const whose parameter spells any[] (pg-protocol writeValues): the parameter is the checked-dynamic array, as it is for a declared function.
const f1 = function (values: any[]): number { return values.length; };
console.log(f1([1, "a"]));
type ValueMapper = (param: any, index: number) => any;
let total = 0;
const writeValues = function (values: any[], valueMapper: ValueMapper | undefined, off: number): void {
  for (let i = 0; i < values.length; i++) {
    const m = valueMapper ? valueMapper(values[i], i) : values[i];
    if (m == null) total += 1;
    else if (m instanceof Buffer) total += m.length;
    else total += String(m).length;
    off++;
  }
  total += off;
};
writeValues(["a", Buffer.from("zz"), null, 5], undefined, 3);
writeValues(["a", 1], (v: any, i: number) => (i === 0 ? v + "!" : v), 1);
console.log(total);
