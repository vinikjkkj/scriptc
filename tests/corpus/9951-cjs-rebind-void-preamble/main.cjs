const I = require('./index.cjs');
const x = new I(21);
console.log(x.get(), I.defaultOptions.a, typeof I.default, typeof I.Redis);
I.print(null, 5);
