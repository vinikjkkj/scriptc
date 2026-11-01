// Error members (message, name, stack) and a refinement member (errors) read through one intersection.
// The errors read is admitted because the guard that narrows the value checks the member.
type AggLike = Error & { errors: Error[] };
function isAgg(e: unknown): e is AggLike {
  return e instanceof Error && Array.isArray((e as unknown as { errors: unknown }).errors);
}
function mk(): unknown {
  const e = new Error('agg') as AggLike;
  e.errors = [new Error('a'), new Error('b')];
  return e;
}
const a = mk();
if (isAgg(a)) {
  console.log(a.message);
  console.log(a.name);
  console.log(typeof a.stack);
  console.log(a.errors.length);
  console.log(a.errors[1].message);
}
