// super(message, options) forwards a parameter: the subclass sees Node's cause rules.
class E extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
  }
}
const inner = new Error('inner');
const a = new E('a', { cause: inner });
const b = new E('b', {});
const d = new E('d');
const f = new E('f', undefined);
for (const e of [a, b, d, f]) {
  console.log(e.message, String((e as Error & { cause?: unknown }).cause), e.name);
}
console.log(String(a.cause) === String(inner));
