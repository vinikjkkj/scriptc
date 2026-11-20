// @exit: 1
// No listener: Node reports the function's text and exits 1 (stderr is not compared).
function named(a: number, b: string): number {
  return a + b.length;
}
console.log("before");
Promise.reject(named);
