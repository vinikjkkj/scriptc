const ck = require("./ck.cjs");
console.log(ck("a"), ck.twice("b"), ck.arrow(3, 4));
const t = ck.twice;
console.log(t("c"), typeof ck.twice, typeof ck.arrow, ck.label);
console.log(ck.twice2("z"));
