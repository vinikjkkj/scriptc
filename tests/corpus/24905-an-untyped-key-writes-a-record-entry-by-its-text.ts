// A record with a string index signature written through a key the program holds untyped: the key is the text of the value (property keys are strings), for a
// string, a number and a value whose toString answers the text. The entries read back by that text.
const keys: any[] = JSON.parse('["a", 7, "b"]');
const rec: Record<string, number> = {};
for (let i = 0; i < keys.length; i++) {
  rec[keys[i]] = i + 1;
}
console.log(Object.keys(rec).join(","), rec["a"], rec["7"], rec["b"]);
const anyKey: any = JSON.parse('"z"');
rec[anyKey] = 9;
console.log(rec["z"], Object.keys(rec).length);
