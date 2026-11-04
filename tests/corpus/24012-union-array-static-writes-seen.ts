// A write the static side makes after the array crossed is seen by the untyped side, and reads of the
// crossed array answer from the array itself.
function snapshot(a: unknown[]): string { return JSON.stringify(a) + ":" + a.length + ":" + String(a[1]); }
const xs: (string | number | null)[] = ["a", 2, null];
console.log(snapshot(xs));
xs.push("z");
xs[1] = "two";
console.log(snapshot(xs));
let keep: unknown[] | undefined;
function hold(a: unknown[]): void { keep = a; }
hold(xs);
xs.pop();
xs[0] = 5;
console.log(JSON.stringify(keep), keep!.length);
keep!.push(1);
console.log(xs, xs.length);
