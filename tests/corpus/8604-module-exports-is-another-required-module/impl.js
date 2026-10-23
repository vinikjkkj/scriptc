'use strict';

let count = 0;

exports.bump = function bump() {
  count += 1;
  return count;
};
exports.read = function read() {
  return count;
};
exports.label = 'impl';
