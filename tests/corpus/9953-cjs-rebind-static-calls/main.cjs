const I = require('./index.cjs');
function run(k) {
    const obj = new I(k);
    I.print(null, obj.get());
    return obj.get() + I.defaultOptions.a;
}
console.log(run(1), run(5));
console.log(typeof I.print, typeof I.defaultOptions);
