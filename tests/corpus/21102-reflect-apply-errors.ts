// Reflect.apply over a value that is not callable, and over an argument list
// that is not an object: Node's TypeError messages, caught and printed.
function tryApply(v: any): void {
  try {
    Reflect.apply(v, null, []);
    console.log("no throw");
  } catch (e) {
    console.log((e as Error).name, (e as Error).message);
  }
}
tryApply(1);
tryApply("s");
tryApply(true);
tryApply(null);
tryApply(undefined);
tryApply({ a: 1 });
tryApply([1, 2]);

function f(a: number): number {
  return a;
}
function tryList(l: any): void {
  try {
    Reflect.apply(f, null, l);
    console.log("no throw");
  } catch (e) {
    console.log((e as Error).name, (e as Error).message);
  }
}
tryList(undefined);
tryList(null);
tryList(5);
tryList("ab");
