const m: Record<string, number> = { "\uFEFFk": 1, "﻿j": 2 };
const ks = Object.keys(m);
console.log(ks.length, ks[0].length, ks[0].charCodeAt(0), ks[1].length, ks[1].charCodeAt(0));
console.log(m["\uFEFFk"], m["﻿j"]);
