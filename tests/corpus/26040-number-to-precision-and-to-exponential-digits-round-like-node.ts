// toPrecision and toExponential(digits) round the exact binary value with ties toward the larger n, on a typed number, a number|undefined and an any, as Node does.
const vals: number[] = [0, -0, 1, -1, 2.5, 0.5, 1.25, 1.005, 123.456, 1234.5678, 1e21, 1e-7, 1.5e-7, 123456789, 0.000123, 99.99, 999.9999, 5e-324, 1.7976931348623157e308, 0.1, 1/3, NaN, Infinity, -Infinity, 25, 35, 1e100, 100, 99.5];
for (const v of vals) {
  const row: string[] = [];
  for (const p of [1, 2, 3, 6, 21, 100]) row.push(v.toPrecision(p));
  for (const f of [0, 1, 2, 5, 20, 100]) row.push(v.toExponential(f));
  row.push(v.toPrecision(), v.toExponential());
  console.log(String(v), row.join(" | "));
}
for (const bad of [0, 101, -1, NaN, 1e9]) {
  try { console.log((1.5).toPrecision(bad)); } catch (e) { console.log((e as Error).name, (e as Error).message); }
  try { console.log((1.5).toExponential(bad)); } catch (e) { console.log((e as Error).name, (e as Error).message); }
}
console.log(Infinity.toPrecision(0), NaN.toExponential(500));
const u: number | undefined = vals.length > 3 ? undefined : 2;
const w: number | undefined = vals.length > 3 ? 4 : undefined;
console.log(Math.PI.toPrecision(u), Math.PI.toPrecision(w), Math.PI.toExponential(u), Math.PI.toExponential(w));
console.log(Math.E.toPrecision(undefined), Math.E.toExponential(undefined));
let n = 0; const next = () => ++n;
console.log((12345.6789).toPrecision(next() + 2), n);
const q: any = JSON.parse('[3.14159, 1234.5, 0.00001234, 2.5]');
for (const x of q) console.log(x.toPrecision(3), x.toPrecision(), x.toExponential(2), x.toExponential(), x["toPrecision"](1));
try { q[0].toPrecision(0) } catch (e) { console.log((e as Error).message) }
try { q[0].toExponential(101) } catch (e) { console.log((e as Error).message) }
console.log(JSON.parse("5").toPrecision(2));
