// for-in over an any-typed value: integer keys ascending, then strings in insertion order; arrays by index; strings by UTF-16 unit; nullish and numbers nothing.
function keys(x: any): string { const out: string[] = []; for (const k in x) out.push(k); return out.join(","); }
console.log(keys({ b: 1, a: 2, 2: 3, 1: 4 }), "|", keys({ b: 1, "10": 1, "2": 1, "-1": 1, "01": 1, "4294967294": 1, a: 1, "1.5": 1 }));
const arr: any = [1, 2]; arr[5] = 1; arr["7"] = 2; arr.x = 3;
console.log(keys([10, 20, 30]), "|", keys(arr), "|", keys([, 1]));
console.log(keys("abc"), "|", keys("héllo😀"), "|", keys(""), "|", keys(5), "|", keys(true), "|", keys(null), "|", keys(undefined));
const parsed: any = JSON.parse('{"z":1,"y":[1,2],"5":0}');
for (const k in parsed) console.log(k, typeof parsed[k]);
for (const k in parsed.y) console.log("y", k);
