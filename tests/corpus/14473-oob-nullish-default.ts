// An out-of-range numeric read defaulted with `??`.
const n: number[] = [1];
const d = n[4] ?? 7;
console.log(d, n[0] ?? 7);
