// An evolving string array walked with for-of, then mapped.
const names = [];
names.push("ada");
names.push("grace");
for (const n of names) console.log(n.toUpperCase());
console.log(names.map((n) => n.length));
