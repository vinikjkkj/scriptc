const env = require('./node.cjs');
console.log(env.read(), env.count, env.bump(), env.count, env.read());
