// The same caught Error instance keeps its identity through several crossings into unknown slots: a dyn array element and the catch binding compare equal, and the class answers on each.
class DB extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'DB';
  }
}
function same(a: unknown, b: unknown): boolean { return a === b; }
function first(xs: unknown[]): unknown { return xs[0]; }
try {
  throw new DB('id', 'I1');
} catch (e) {
  const arr: unknown[] = [e];
  console.log(same(arr[0], e), same(e, e), same(first(arr), e));
  console.log(String(first(arr) instanceof DB), String(first(arr) instanceof Error));
  console.log((first(arr) as any).code);
}
