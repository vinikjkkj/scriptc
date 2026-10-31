// Reflect.apply over a typed function, a method with a receiver, an any-typed
// function and a closure: each answers the call Node makes.
function add(a: number, b: number): number {
  return a + b;
}

const obj = {
  base: 10,
  f(this: { base: number }, x: number): number {
    return this.base + x;
  },
};

console.log(Reflect.apply(add, null, [1, 2]));
console.log(Reflect.apply(obj.f, obj, [5]));
console.log(Reflect.apply(obj.f, { base: 100 }, [5]));

const anyFn: any = (x: number, y: string) => `${x}-${y}`;
console.log(Reflect.apply(anyFn, undefined, [7, "z"]));

let k = 3;
const closure = (x: number) => x * k;
k = 4;
console.log(Reflect.apply(closure, null, [5]));

function mk(n: number): number {
  const local = (x: number) => x + n;
  return Reflect.apply(local, undefined, [1]);
}
console.log(mk(41));
