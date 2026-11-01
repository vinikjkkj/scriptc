// The intersection passed to a function that expects a plain Error, and back.
function describe(e: Error): string {
  return e.name + ':' + e.message;
}
function tagged(msg: string): Error & { tag: string } {
  const e = new SyntaxError(msg) as SyntaxError & { tag: string };
  e.tag = 'syn';
  return e;
}
const t = tagged('bad json');
console.log(describe(t), t.tag);
