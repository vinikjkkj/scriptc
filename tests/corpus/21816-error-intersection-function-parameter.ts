// The intersection passed to a function that expects a plain Error, and back.
function describe(e: Error): string {
  return e.name + ':' + e.message;
}
const t = new SyntaxError('bad json') as SyntaxError & { tag: string };
t.tag = 'syn';
console.log(describe(t), t.tag);
