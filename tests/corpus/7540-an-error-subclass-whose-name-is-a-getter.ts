// The display name of an Error subclass, spelled the way every Error
// hierarchy in the wild spells it: `override get name()` returning a
// constant. Node answers it through a prototype accessor; the compiler
// routes it onto ScrError's inherited `name` slot, so one memory answers
// the subclass view, every `Error` view, and the runtime's toString.
class AppError extends Error {
  override get name(): string {
    return 'AppError';
  }
}

class NotFound extends AppError {
  // A LITERAL return type, not `string` — bson spells its leaves this way.
  override get name(): 'NotFound' {
    return 'NotFound';
  }
}

// No override: JS resolves `name` up the prototype chain to AppError's
// getter, and the routed slot holds what AppError's stamp wrote.
class Timeout extends AppError {}

const a = new AppError('a failed');
const n = new NotFound('n missing');
const t = new Timeout('t expired');

console.log(a.name, a.message, String(a));
console.log(n.name, n.message, String(n));
console.log(t.name, t.message, String(t));

console.log(a instanceof AppError, a instanceof Error, a instanceof NotFound);
console.log(n instanceof NotFound, n instanceof AppError, n instanceof Error);
console.log(t instanceof Timeout, t instanceof AppError, t instanceof Error);

// The `Error` VIEW: an upcast is a reinterpret here, so this reads the
// very slot the getter's constant was stamped into.
function describe(e: Error): string {
  return e.name + ': ' + e.message;
}
console.log(describe(a), '|', describe(n), '|', describe(t));
console.log(describe(new Error('plain')), '|', describe(new TypeError('bad')));

// An own field initializer reads `this.name` — in Node the prototype
// getter exists before any instance does, so it sees 'Stamped', never the
// inherited 'Error'.
class Stamped extends AppError {
  tag: string = this.name + '#1';
  override get name(): string {
    return 'Stamped';
  }
}
const s = new Stamped('s');
console.log(s.tag, s.name, String(s));

try {
  throw n;
} catch (err) {
  if (err instanceof AppError) console.log('caught', err.name, err.message, String(err));
}
