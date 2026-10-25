// Through an `unknown` view, a caught Error subclass answers its own fields, message, name, its prototype method (a dynamic call), and its constructor's name, as Node does.
class DB extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'DB';
  }
  describe(): string { return 'desc:' + this.code; }
}
function viaDyn(e: unknown): string {
  const x = e as any;
  const ctor = x.constructor.name;
  return x.describe() + '|' + x.code + '|' + x.message + '|' + x.name + '|' + ctor + '|' + (x instanceof DB);
}
function callDyn(e: unknown): string {
  return String((e as any).describe()) + ' ' + String(e instanceof DB);
}
try {
  throw new DB('mm', 'K1');
} catch (e) {
  console.log(viaDyn(e));
  console.log(callDyn(e));
}
