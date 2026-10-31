// @ts-nocheck
// Unguarded `.call` / `.apply` in unchecked JS, where the callee reads its thisArg. The receivers
// are parameters typed by JSDoc (dynamic in the lowering); a nullish one throws Node's TypeError.
function add(a) {
  return [this.k, a + 1];
}
/** @param {((a: number) => any[]) | undefined} f */
function callLive(f) {
  console.log(f.call({ k: 3 }, 4));
  console.log(f.apply({ k: 9 }, [5]));
}
/** @param {((a: number) => any[]) | null | undefined} f */
function callNullable(f) {
  try {
    console.log(f.call({ k: 3 }, 4));
  } catch (e) {
    console.log("caught", e.name, e.message);
  }
}
callLive(add);
callNullable(undefined);
callNullable(null);
callNullable(add);
