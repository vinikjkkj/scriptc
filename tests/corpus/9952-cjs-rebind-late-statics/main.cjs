const I = require('./index.cjs');
function show() {
    console.log(I.version, I.label, I.table.b[1], I.double(I.version));
}
show();
const x = new I(4);
console.log(x.get(), I.defaultOptions.a);
I.print(null, "ok");
