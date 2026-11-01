// Reflect.construct over a value that is not a constructor, and over an
// undefined or null argument list.
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
