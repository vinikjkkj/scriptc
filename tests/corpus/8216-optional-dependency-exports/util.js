'use strict';

function _mask(source, mask) {
  return 'js:' + source + mask;
}

function _unmask(buffer) {
  return 'js-un:' + buffer;
}

module.exports = {
  mask: _mask,
  unmask: _unmask,
  version: 3
};

/* the optional native accelerator: not installed, so the try body stops at
   the require and the exports keep the pure-JS functions */
if (!process.env.NO_ACCEL_FOR_THIS_TEST) {
  try {
    const accel = require('accelerator-package-that-is-not-installed');

    module.exports.mask = function (source, mask) {
      return 'native:' + accel.mask(source, mask);
    };

    module.exports.unmask = function (buffer) {
      return 'native-un:' + accel.unmask(buffer);
    };
  } catch (e) {
    // continue regardless of the error
  }
}
