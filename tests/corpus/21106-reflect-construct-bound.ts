// [[Construct]] of a bound function: the target constructs with the bound
// arguments first, the bound receiver is ignored, and a result object the
// constructor returns is the answer. A bound arrow is not a constructor.
const pairFn: any = function (x: number): number[] {
  return [x];
};
const boundPair: any = pairFn.bind(null, 5);
const made: any = Reflect.construct(boundPair, []);
console.log(typeof made, made[0]);

const arrowFn: any = (x: number): number => x;
const boundArrow: any = arrowFn.bind(null, 1);
try {
  Reflect.construct(boundArrow, []);
  console.log("constructed");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
