'use strict';
const caching_sha2_password = require('./plugin.cjs');
const standardAuthPlugins = Object.assign(Object.create(null), {
  caching_sha2_password: caching_sha2_password({}),
});
console.log(standardAuthPlugins.caching_sha2_password({ connection: 2 })(39));
