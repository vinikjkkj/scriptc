// Reflect.construct over a value that is not a constructor, and over an
// argument list that is not an object.
function tryNew(v: any): void {
  try {
    Reflect.construct(v, []);
    console.log("no throw");
  } catch (e) {
    console.log((e as Error).name, (e as Error).message);
  }
}
tryNew(1);
tryNew("s");
tryNew(true);
tryNew(null);
tryNew(undefined);
tryNew({ a: 1 });

class K {}
function tryList(l: any): void {
  try {
    Reflect.construct(K, l);
    console.log("no throw");
  } catch (e) {
    console.log((e as Error).name, (e as Error).message);
  }
}
tryList(undefined);
tryList(null);
tryList(5);
