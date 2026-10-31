// Reflect.apply with an argument list built at run time: its length and its
// element types are only known while the program runs.
function sum(...xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

const list: number[] = [];
for (let i = 0; i < 5; i++) list.push(i * i);
console.log(Reflect.apply(sum, null, list));
console.log(Reflect.apply(sum, null, []));

const words: string[] = [];
const parts = "a,b,c".split(",");
for (const p of parts) words.push(p.toUpperCase());
const joiner = (sep: string, ...rest: string[]): string => rest.join(sep);
console.log(Reflect.apply(joiner, null, ["-", ...words]));
console.log(Reflect.apply(joiner, null, [":", "x", "y"]));
