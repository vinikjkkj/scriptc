// Reflect.apply with a typed array as the argument list (converted element by element).
function sum2(a: number, b: number): number {
  return a + b;
}
const bytes = new Uint8Array([3, 4]);
console.log(Reflect.apply(sum2, null, bytes));
const xs: any[] = [10, 20];
console.log(Reflect.apply(sum2, null, xs));
