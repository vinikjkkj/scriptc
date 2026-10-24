const defs = {
  sjis: { type: "_dbcs", table: function () { return require("./rows.json"); }, encodeAdd: { "¥": 0x5c } },
  other: { type: "_dbcs", table: function () { return require("./rows.json"); } },
  flags: { table: function () { return require("./flags.json"); } },
};
const t1 = defs.sjis.table();
const t2 = defs.other.table();
console.log(t2.length === t1.length, t1.length, t1[0][2], t1[1][1], t1[2].length);
console.log(t1);
let strings = 0;
let numbers = 0;
for (const row of t1) {
  for (const cell of row) {
    if (typeof cell === "string") strings++;
    else numbers++;
  }
}
console.log(strings, numbers);
const f = defs.flags.table();
console.log(f, f.length);
