'use strict';
// mysql2's typed_parameter table: a factory per type built in a loop, each closing over the loop's own bindings, some
// carrying an `unsigned` variant as a property of the function.
class Param {
  constructor(type, value, unsigned) {
    this.type = type;
    this.value = value;
    this.unsigned = unsigned;
  }
}
const SUPPORTED = [1, 2, 3, 4];
const NAMES = { 1: 'tiny', 2: 'small', 3: 'text', 4: 'blob' };
const BYTES = { 1: 1, 2: 2 };
function checked(value, type, bytes, unsigned) {
  return value * bytes + (unsigned ? 1000 : 0);
}
const types = Object.create(null);
for (const type of SUPPORTED) {
  const name = NAMES[type];
  const bytes = BYTES[type];
  const build = bytes
    ? (value, unsigned) => new Param(type, value === null ? null : checked(value, type, bytes, unsigned), unsigned)
    : (value, unsigned) => new Param(type, value, unsigned);
  const factory = (value) => build(value, false);
  if (bytes) {
    factory.unsigned = (value) => build(value, true);
  }
  types[name] = factory;
}
types.nil = () => new Param(0, null, false);
exports.make = (name, value) => types[name](value);
exports.makeUnsigned = (name, value) => types[name].unsigned(value);
exports.hasUnsigned = (name) => typeof types[name].unsigned === 'function';
exports.names = () => Object.keys(types);
