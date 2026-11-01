// TypeError & { code: string }: a refinement member named like the errno slot, written and read.
// The catch-side read is admitted because the guard that narrows the value checks the member.
function isCoded(e: unknown): e is TypeError & { code: string } {
  return e instanceof TypeError && typeof (e as { code?: unknown }).code === 'string';
}
const t = new TypeError('bad') as TypeError & { code: string };
t.code = 'E_BAD';
console.log(t.message, t.name, t.code);
try {
  throw t;
} catch (e) {
  if (isCoded(e)) console.log(e.code, e instanceof TypeError, e.message);
}
