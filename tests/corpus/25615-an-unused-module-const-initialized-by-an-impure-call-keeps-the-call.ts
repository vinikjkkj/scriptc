// The initializer calls a function that writes a module-level counter: the call is an effect, so the unused const is still evaluated, once, in order.
let calls = 0;
function mk(): number[] {
  calls += 1;
  console.log("mk called", calls);
  return [calls, calls * 2];
}
export const UNUSED_A = mk();
export const UNUSED_B = mk();
console.log("calls", calls);
