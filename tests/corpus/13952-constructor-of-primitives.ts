// .constructor of a primitive is the wrapper constructor; compared by identity.
function ctorIsString(v: string | number | boolean): boolean { return v.constructor === String; }
function ctorIsNumber(v: string | number | boolean): boolean { return v.constructor === Number; }
function ctorIsBoolean(v: string | number | boolean): boolean { return v.constructor === Boolean; }
console.log(ctorIsString('abc'), ctorIsString(7), ctorIsString(false), ctorIsString(''));
console.log(ctorIsNumber(7), ctorIsNumber(0), ctorIsNumber('7'), ctorIsNumber(NaN));
console.log(ctorIsBoolean(true), ctorIsBoolean(false), ctorIsBoolean(1), ctorIsBoolean('true'));
function kind(v: number | boolean | string): string {
  if (v.constructor === Number) return 'number';
  if (v.constructor === Boolean) return 'boolean';
  if (v.constructor === String) return 'string';
  return 'other';
}
console.log(kind(3), kind(true), kind('x'), kind(0), kind(false), kind(''));
