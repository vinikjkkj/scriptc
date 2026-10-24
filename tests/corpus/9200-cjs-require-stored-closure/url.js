'use strict';

exports.make = tag => Impl.make(tag);
exports.is = value => value !== null && typeof value === 'object' && value.tag === 'made';
exports.describe = function () {
  return 'impl:' + Impl.name;
};

const Impl = require('./impl.js');
