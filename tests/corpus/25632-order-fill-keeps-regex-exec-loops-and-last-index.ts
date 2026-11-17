const cold = process.env.COLD === "1";
const re = /(\d+)-(\w+)/g;
const text = "10-ab 22-cd x 303-ef 4-g";
const out: string[] = []; let m: RegExpExecArray | null;
while ((m = re.exec(text)) !== null) out.push(m[1] + ":" + m[2] + "@" + re.lastIndex);
const sticky = /a+/y; sticky.lastIndex = cold ? 2 : 0;
console.log(out.join("|"), sticky.test("baaa"), sticky.lastIndex);
