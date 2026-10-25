// A caught Error subclass passed into an `unknown` parameter keeps its class: instanceof against the subclass, its base, and Error answers as Node does, and so do the own fields and the prototype method reached after narrowing.
class DB extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'DB';
  }
  describe(): string { return 'desc:' + this.code; }
}
class Sub extends DB {
  extra = 7;
  describe(): string { return 'sub:' + this.code + ':' + this.extra; }
}
function d(e: unknown): string {
  const parts: string[] = [];
  parts.push(String(e instanceof DB), String(e instanceof Sub), String(e instanceof Error));
  parts.push(String(e instanceof TypeError));
  parts.push(String(e));
  if (e instanceof DB) parts.push(e.describe());
  return parts.join(' ');
}
try {
  throw new Sub('m', 'S1');
} catch (e) {
  console.log(d(e));
}
try {
  throw new DB('m2', 'C9');
} catch (e) {
  console.log(d(e));
}
try {
  throw new TypeError('tt');
} catch (e) {
  console.log(d(e));
}
console.log(d(new Sub('x', 'S2')));
