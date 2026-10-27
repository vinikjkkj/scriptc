const l = require("./lib.cjs");
const c = l.codec();
l.load();
console.log(c.api.encodings.hi, l.encodings.hi);
