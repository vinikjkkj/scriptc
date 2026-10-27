// locals typed T | null / T | undefined, reassigned from a run-time loop so no fold can answer
let k = 0;
for (let i = 0; i < 3; i++) k += i;
const v: string | null = k > 2 ? null : "s";
console.log(`${v}|${"" + v}|${String(v)}`);
const w: number | undefined = k > 5 ? 1 : undefined;
console.log(`${w}|${"" + w}|${String(w)}`);
const x: string | null = k > 9 ? "big" : null;
console.log(`pre-${x}-post`, x + "!", String(x));
