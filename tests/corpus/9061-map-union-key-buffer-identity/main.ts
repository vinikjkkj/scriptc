const b1 = Buffer.from("ab");
const b2 = Buffer.from("ab");
const m = new Map<string | Buffer, number>();
m.set(b1, 1); m.set(b2, 2); m.set("ab", 3);
console.log(m.get(b1), m.get(b2), m.get("ab"), m.size, m.has(Buffer.from("ab")));
