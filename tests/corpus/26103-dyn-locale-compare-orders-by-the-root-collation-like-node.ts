// localeCompare on a dyn receiver (any) runs the same CLDR root collation, in the dot, computed and callback spellings.
const w: any = JSON.parse('["banana","Apple","cherry","apple","Banana","éclair","eclair","Zed","zed","a b","ab","10","2","résumé","resume","ä","z","Z"]');
const d: any = JSON.parse('"a"');
console.log(d.localeCompare("B"), d.localeCompare("A"), d.localeCompare("a"), d["localeCompare"]("é"));
let acc = "";
for (let i = 0; i < w.length; i++) acc += w[i].localeCompare(w[(i + 1) % w.length]) + " ";
console.log(acc);
const n: any = JSON.parse("5");
console.log(d.localeCompare(n), d.localeCompare(JSON.parse("null")), d.localeCompare(JSON.parse('"\\u0301"')));
const m = "localeCompare";
console.log(w[0][m](w[1]), w[1][m](w[0]));
