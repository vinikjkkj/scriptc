const a: number[][] = [[1], [2]];
function at(i: number, j: number) {
  try { console.log(a[i][j]); } catch (e) { console.log((e as Error).message); }
}
at(0, 0); at(1, 5); at(7, 0); at(0, 1.5); at(-1, 2);
function sset(i: number, j: number) {
  try { a[i][j] = 9; } catch (e) { console.log((e as Error).message); }
}
sset(5, 1);
const xs = [10, 20, 30];
function fr(i: number) { console.log(xs[i], xs[i] + 1, String(xs[i])); }
fr(1.5); fr(-1); fr(2); fr(NaN); fr(1);
const fns: (() => number)[] = [() => 1];
try { console.log(fns[0]()); console.log(fns[3]()); } catch (e) { console.log((e as Error).message); }
const idx = 4;
try { console.log(fns[idx]()); } catch (e) { console.log((e as Error).message); }
const ss: string[][] = [["a"]];
function sl(i: number) { try { console.log(ss[i].length); } catch (e) { console.log((e as Error).message); } }
sl(0); sl(2);
