// TypeError & { code: string }: a refinement member named like the errno slot, written and read.
function fail(): TypeError & { code: string } {
  const t = new TypeError('bad') as TypeError & { code: string };
  t.code = 'E_BAD';
  return t;
}
const t = fail();
console.log(t.message, t.name, t.code);
try {
  throw fail();
} catch (e) {
  const err = e as TypeError & { code: string };
  console.log(err.code, err instanceof TypeError, err.message);
}
