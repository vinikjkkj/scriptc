const e = "\uD83D\uDE00";
const l = "😀";
console.log(e.length, e.charCodeAt(0), e.charCodeAt(1), l.length, e === l);
console.log(e.charCodeAt(0) === 0xD83D, [...l].length, `\uD83D\uDE00!`.length);
const mixed = "a\uD83D\uDE00b";
console.log(mixed.length, mixed.charCodeAt(3), mixed.slice(1, 3) === e);
