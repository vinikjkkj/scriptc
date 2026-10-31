// @ts-nocheck
// `f.call(t, ...)` / `f.apply(t, [...])` on a function value typed `F | undefined` with no guard:
// a live receiver calls with the given this; a nullish receiver throws Node's TypeError at the
// `.call` read, before the thisArg and the arguments evaluate.
function add(this: unknown, a: number): number {
  return a + 1;
}
function pick(flag: boolean): ((this: unknown, a: number) => number) | undefined {
  return flag ? add : undefined;
}
let sideEffects = 0;
function bump(): number {
  sideEffects += 1;
  return 7;
}
const live = pick(true);
console.log(live.call(null, 2));
console.log(live.apply({ k: 1 }, [9]));
const dead = pick(false);
try {
  console.log(dead.call({ k: 3 }, bump()));
} catch (e) {
  console.log("caught", (e as Error).name, (e as Error).message, sideEffects);
}
try {
  console.log(dead.apply(null, [bump()]));
} catch (e) {
  console.log("caught", (e as Error).name, (e as Error).message, sideEffects);
}
console.log(sideEffects);
