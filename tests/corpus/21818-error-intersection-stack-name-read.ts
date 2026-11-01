// The stack and name members of an intersection-typed error read in a helper; the optional refinement member is undefined-safe.
function header(e: Error & { id?: number }): string {
  const first = (e.stack ?? '').split('\n')[0];
  return e.name + '/' + String(e.id) + '/' + (first.length > 0 ? 'stack' : 'none');
}
const e = new RangeError('deep') as RangeError & { id?: number };
e.id = 42;
console.log(header(e));
