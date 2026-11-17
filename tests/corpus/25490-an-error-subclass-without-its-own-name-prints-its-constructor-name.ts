// Node's improveStack: an error whose `name` is still the inherited "Error" but whose constructor is a subclass prints the constructor first.
// `[Quiet [Error]: q]` when the constructor name does not contain the name, `[ValidationError: v]` when it does. The stack text is unchanged.
(Error as any).stackTraceLimit = 0;
class Quiet extends Error {}
class Deep extends Quiet {}
class ValidationError extends Error {}
class DeeperValidationError extends ValidationError {}
const a = new Quiet('q');
const b = new Deep('p');
const c = new ValidationError('v');
const d = new DeeperValidationError('d');
console.log(a);
console.log(b);
console.log(c);
console.log(d);
console.log(String(a), '|', a.name, '|', a.stack);
console.log(String(d), '|', d.name, '|', d.stack);
console.log([a]);
console.log({ err: c });
