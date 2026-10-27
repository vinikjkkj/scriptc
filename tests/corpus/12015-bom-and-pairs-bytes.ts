const s = "\uFEFF\uD83D\uDE00";
const b = Buffer.from(s, "utf8");
console.log(s.length, b.length, b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
process.stdout.write(s + "|" + "\u200B" + "\n");
