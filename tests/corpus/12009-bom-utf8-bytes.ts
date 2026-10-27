const s = "\uFEFFa" + "﻿";
const b = Buffer.from(s, "utf8");
console.log(b.length, b[0], b[1], b[2], b[3], b[4], b[5]);
const e = new TextEncoder().encode("\uFEFF");
console.log(e.length, e[0], e[1], e[2]);
process.stdout.write("\uFEFF|" + "﻿\n");
