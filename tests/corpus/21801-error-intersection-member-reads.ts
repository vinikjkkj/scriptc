// Error members (message, name, stack) and a refinement member (errors) read through one intersection.
function mk(): Error & { errors: Error[] } {
  const e = new Error('agg') as Error & { errors: Error[] };
  e.errors = [new Error('a'), new Error('b')];
  return e;
}
const a = mk();
console.log(a.message);
console.log(a.name);
console.log(typeof a.stack);
console.log(a.errors.length);
console.log(a.errors[1].message);
