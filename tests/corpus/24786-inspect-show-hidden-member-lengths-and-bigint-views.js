import util from "node:util";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HN = JSON.parse('{"showHidden":true,"numericSeparator":true}');
function show(v) { for (const o of [H, HC, HN]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
class L1 { constructor(a, b = 2, c) {} m(a, b = 1, c) {} r(a, ...rest) {} z(a, b) {} get g() { return 1; } static s(a = 1) {} static t(a, b, ...c) {} static u(a, b) {} }
class L2 { constructor(...args) {} }
class L3 { constructor(a, b) {} }
show(JSON.parse("0") || L1);
show(JSON.parse("0") || L2);
show(JSON.parse("0") || L3);
show(new BigInt64Array([1n, -2n, 1234567n]));
show(new BigUint64Array([18446744073709551615n, 0n]));
show(new BigInt64Array(0));
show(new BigInt64Array(120));
show([new BigUint64Array(2)]);
