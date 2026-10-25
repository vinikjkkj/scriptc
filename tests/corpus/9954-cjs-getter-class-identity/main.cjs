const I = require('./index.cjs');
const x = new I(21);
console.log(typeof I, I.name, x.get(), I.defaultOptions.a, I.default === I, I.Redis === I);
I.print(null, 5);
