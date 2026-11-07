// A store loop whose array variable is still unset when the loop is entered (a captured var, a global assigned later) while the program freezes that array type elsewhere: the loop-entry flag test must not read the unset variable. Matches Node: the stores never run.
function f(n: number): string {
  var a: number[];
  const g = (): number => {
    let hits = 0;
    for (let i = 0; i < n; i++) { if (i > 100) { a[i] = i; hits++; } }
    return hits;
  };
  const before = g();
  a = [1, 2, 3];
  Object.freeze(a);
  return before + ":" + g() + ":" + a.join();
}
console.log(f(3));
var top: number[];
function h(n: number): number {
  let hits = 0;
  for (let i = 0; i < n; i++) { if (i > 100) { top[i] = i; hits++; } }
  return hits;
}
console.log(h(3));
top = [4, 5];
Object.freeze(top);
console.log(h(3), top.join());
