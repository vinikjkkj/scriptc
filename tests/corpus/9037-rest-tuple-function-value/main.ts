type F = (...args: [kind: string, ...parts: number[]]) => number;
function total(...args: [kind: string, ...parts: number[]]): number {
  let t = 0;
  for (let i = 1; i < args.length; i++) t += args[i] as number;
  console.log(args[0], args.length);
  return t;
}
const f: F = total;
console.log(f("a", 1, 2, 3));
console.log(total("b"));
