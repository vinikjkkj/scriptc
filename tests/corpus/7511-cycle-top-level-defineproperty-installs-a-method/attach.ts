// OUTSIDE the cluster. `attach`'s whole body is one Object.defineProperty
// whose descriptor carries a FUNCTION. That is the fact the cycle fence
// lacked: the guard refusing any function-shaped argument to a builtin
// exists because most builtins that take one CALL it, and this one
// installs it.
export class Cell {
  readonly tag: string;
  constructor(t: string) {
    this.tag = t;
  }
  show(): string {
    return "cell " + this.tag;
  }
}

export function attach(target: Cell, name: string, tag: string): void {
  Object.defineProperty(target, name, {
    get: () => "extra of " + tag,
    enumerable: false,
    configurable: true,
  });
}
