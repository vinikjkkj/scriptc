// Object.prototype.toString.call over an unknown that holds a Symbol answers [object Symbol] like Node.
function tag(x: unknown) { return Object.prototype.toString.call(x); }
console.log(tag(Symbol("s")), tag([]));
