const util = require('util');
var Native;
// eslint-disable-next-line no-useless-catch
try {
  Native = require('pg-native-that-is-not-installed');
} catch (e) {
  throw e;
}
const Client = (module.exports = function (config) {
  this.native = new Native({ x: 1 });
  this.config = config || {};
});
Client.prototype.connect = function (cb) {
  cb(null);
};
util.inherits(Client, Object);
const NativeQuery = require('./query.js');
Client.Query = NativeQuery;
