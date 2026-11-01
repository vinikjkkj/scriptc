// mongodb error.ts shape: a type guard narrows an unknown to Error & { errors: Error[] },
// then the message, the errors array and a destructured member are read.
type AggLike = Error & { errors: Error[] };
function isAggregateError(e: unknown): e is AggLike {
  return e != null && typeof e === 'object' && 'errors' in e && Array.isArray((e as { errors: unknown }).errors);
}
function buildMsg(e: unknown): string {
  if (isAggregateError(e) && e.message.length === 0) {
    return e.errors.length === 0
      ? 'empty errors array'
      : e.errors.map(({ message }) => message).join(', ');
  }
  return e != null && typeof e === 'object' && 'message' in e && typeof e.message === 'string' ? e.message : 'empty error message';
}
const agg = new Error('') as AggLike;
agg.errors = [new Error('p'), new Error('q')];
console.log(buildMsg(agg));
console.log(buildMsg(new Error('')));
console.log(buildMsg(new Error('plain')));
console.log(buildMsg('text'));
