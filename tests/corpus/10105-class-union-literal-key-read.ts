// A computed read whose key is a union of string literals dispatches per literal, on an instance and on a class prototype.
class Pair {
  a: number = 1;
  b: string = 'bee';
  c: boolean = true;
  first(): string { return 'first:' + this.b; }
  second(): string { return 'second:' + this.a; }
}
function readInstance(p: Pair, k: 'a' | 'b'): string {
  return String(p[k]);
}
function readMethod(k: 'first' | 'second'): string {
  const f = Pair.prototype[k];
  return typeof f;
}
const p = new Pair();
console.log(readInstance(p, 'a'), readInstance(p, 'b'));
console.log(readMethod('first'), readMethod('second'));
console.log(Pair.prototype['first'].call(p), Pair.prototype['second'].call(p));
