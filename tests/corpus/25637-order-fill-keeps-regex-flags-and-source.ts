const cold = process.env.COLD === "1";
const r = new RegExp(cold ? "a.c" : "abc", cold ? "gis" : "g");
console.log(r.source, r.flags, "a\nC".search(new RegExp("a.c", "is")), String(r));
