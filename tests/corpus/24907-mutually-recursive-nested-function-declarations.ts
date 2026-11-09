// Nested function declarations that call each other, each also reading a variable of the enclosing function (the shape of the debug package's setup():
// createDebug and extend reference one another). The declarations are hoisted, so either may be called as soon as the enclosing function returns one of
// them, and a third declaration joins the cycle.
function setup(prefix: string): { first: (n: string) => string; second: (n: string) => string; third: (n: number) => number } {
  function first(n: string): string {
    return prefix + second(n);
  }
  function second(n: string): string {
    return n.length > 4 ? n : first(n + "a");
  }
  function third(n: number): number {
    return n <= 0 ? 0 : n + fourth(n - 1);
  }
  function fourth(n: number): number {
    return n <= 0 ? 0 : third(n - 1) * 2;
  }
  return { first, second, third };
}
const s = setup("p:");
console.log(s.first("xy"), s.second("x"), s.third(5));
const t = setup("q:");
console.log(t.first("abcde"), t.second("a"), t.third(3));
