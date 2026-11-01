// Reflect.apply over a value that is not callable, and over an argument list
// that is undefined or null: Node's TypeError messages, caught and printed.
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
