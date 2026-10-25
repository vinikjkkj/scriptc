// A required plugin factory called inside an object literal (mysql2's auth table shape).
const sha256 = require('./plugin.cjs');
const plugins = Object.assign(Object.create(null), { sha: sha256({ k: 1 }), other: sha256({}) });
console.log(plugins.sha(), plugins.other(), Object.keys(plugins).join(','));
