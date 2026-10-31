// @ts-nocheck
// `?.call` and `?.apply` on a possibly-nullish function value: nullish short-circuits to undefined
// and the arguments do not evaluate; a live receiver calls with the given this.
function add(this: unknown, a: number): number {
  return a + 1;
}
let evaluated = 0;
function arg(): number {
  evaluated += 1;
  return 2;
}
function optCall(f: ((this: unknown, a: number) => number) | undefined): number | undefined {
  const r = f?.call({ k: 1 }, arg());
  return r;
}
function optApply(f: ((this: unknown, a: number) => number) | null | undefined): number | undefined {
  const r = f?.apply({ k: 4 }, [arg()]);
  return r;
}
console.log(optCall(add), optCall(undefined));
console.log(optApply(null), optApply(add));
console.log(evaluated);
