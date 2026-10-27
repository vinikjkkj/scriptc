const m = require("./lib.cjs");
m.flush();
console.log(m.a, m.b, Object.keys(m).join(","));
