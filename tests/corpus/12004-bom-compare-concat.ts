let e = "\uFEFF";
console.log(e === String.fromCharCode(0xFEFF), e === "\u0000", (e + "a").length, "\uFEFF".length);
console.log("\uFEFF" === "\u{FEFF}", ["\uFEFF"].indexOf(String.fromCharCode(65279)));
