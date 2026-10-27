'use strict';
const calc = (p) => p * 2;
const pluginFactory =
  (pluginOptions = {}) =>
  ({ connection }) =>
    (data) => data + (pluginOptions.x || 0) + connection;
module.exports = pluginFactory;
module.exports.calc = calc;
