const I = require('./index.cjs');
const x = new I(21);
console.log(x.get(), I.version, I.defaultOptions.a);
I.print(null, 5);
