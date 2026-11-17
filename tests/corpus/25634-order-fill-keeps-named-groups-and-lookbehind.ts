const cold = process.env.COLD === "1";
const m = /(?<year>\d{4})-(?<mon>\d{2})/.exec("on 2026-11-17") as RegExpExecArray;
console.log(m[1], m[2], cold ? "price $42 and 17".match(/(?<=\$)\d+/)![0] : "none", "x1y2".replace(/(?<d>\d)/g, "[$<d>]"));
