// Strings built up from a one-character start (a placeholder, a separator, a single char) are appended to in loops and through aliases: the starting
// string and every alias keep their own value.
const start = String.fromCharCode(63);
let a = "" + "?";
const alias = a;
a += "x";
a += "yz";
console.log(a, alias, start, alias === start, a.length, alias.length);
let acc = ["?"].join("");
const snapshots: string[] = [];
for (let i = 0; i < 40; i++) { snapshots.push(acc); acc += String.fromCharCode(97 + (i % 26)); }
console.log(acc, snapshots[0], snapshots[1], snapshots[39]!.length, snapshots.every((s, i) => s.length === i + 1 && s.startsWith("?")));
const marks: string[] = [];
for (let i = 0; i < 5000; i++) marks.push("?" + (i % 2 === 0 ? "" : ""));
let sql = "SELECT * FROM t WHERE id IN (";
sql += marks.slice(0, 20).join(",");
sql += ")";
console.log(sql, marks.every((m) => m === "?"), marks[4999]);
const parts: string[] = [];
for (let i = 0; i < 6; i++) { let p = "" + "-"; for (let j = 0; j < i; j++) p += "-"; parts.push(p); }
console.log(parts.join("|"), parts.map((p) => p.length).join(","));
const kids = [..."x?y?z"].map((c) => { let s = c; s += c; return s; });
console.log(kids.join(","), [..."x?y?z"].join(""));
