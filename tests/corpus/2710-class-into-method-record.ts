// A class instance flowing into a record slot whose fields are METHODS:
// a ConsoleLogger passed as the structural `Logger` its consumers declare.
//
// The field-projecting plan declines here on purpose -- a bound method
// reference is not plain storage to copy -- and that reads like a dead end.
// It is not: the ctor-witness projection already builds exactly those
// thunks, each capturing the instance, for the constructor-witness path.
// The two only needed to meet, so the object-into-record coercion now
// falls through to it when the field plan declines.
//
// The method signatures must match the field types exactly, which is what
// makes the thunk honest rather than a guess. Note `child` returns the
// INTERFACE, not the class -- a class-returning child would need the
// projection applied to its own result, which this does not do.

type Meta = { [k: string]: unknown };
interface Logger {
  readonly level: string;
  debug(m: string, x?: Meta): void;
  child(b: Meta, o?: { readonly level?: string }): Logger;
}
class ConsoleLogger implements Logger {
  readonly level: string;
  constructor(level: string) { this.level = level; }
  debug(m: string, x?: Meta): void { console.log("[d]", m, x === undefined ? "-" : "meta"); }
  child(_b: Meta, o?: { readonly level?: string }): Logger { return new ConsoleLogger(o?.level ?? this.level); }
}
function use(l: Logger): void { l.debug("oi"); l.debug("com", { a: 1 }); console.log(l.level, l.child({}).level); }
use(new ConsoleLogger("info"));
