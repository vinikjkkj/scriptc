// A builtin constructor global used only as the RECEIVER of a member access (Object.create, Array.isArray, String.fromCharCode, ...)
// reads its statics by name; it never becomes a constructor value, so none of these may be refused or change.
function mk(e, t) {
  return Object.create(Error.prototype, {
    constructor: { value: t, writable: true, enumerable: false, configurable: true },
    name: { get: function () { return e; }, set: void 0, enumerable: false, configurable: true },
    toString: { value: function () { return this.name + ": " + this.message; }, writable: true, enumerable: false, configurable: true },
  });
}
const E = mk("Boom", Error);
console.log(E.name, String(E));
const xs = [1];
console.log(Array.isArray(xs), String.fromCharCode(72, 105), Number.isInteger(4), Number.parseFloat("2.5"));
console.log(Object.keys({ a: 1, b: 2 }).join(), Object.values({ x: 1 }).join());
