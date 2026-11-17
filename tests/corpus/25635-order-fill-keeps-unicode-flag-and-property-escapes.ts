const cold = process.env.COLD === "1";
const s = "café 中文 abc";
console.log(s.match(/\p{L}+/gu)!.join(","), /^\p{Lu}/u.test("Éa"), cold ? "😀x".match(/./gu)!.length : 0);
