// console.table column widths use Node's ICU string width: East Asian wide and fullwidth, emoji presentation and modifiers, combining marks,
// soft hyphen, controls and ANSI escapes in keys, and NFC normalization before measuring.
const run: any = new Function(`
  console.table([{ a: "\\u65e5\\u672c\\u8a9e", b: 1 }, { a: "x", b: "\\uff71\\uff72" }, { a: "\\u00e9", b: "\\ud83d\\udc4d\\ud83c\\udffd" }, { a: "e\\u0301", b: "ab\\u00adc" }]);
  console.table([["\\ud55c\\uae00", "\\uac00"], ["\\u1100\\u1161", "\\ud83d\\ude00\\ud83d\\ude00"]]);
  console.table([{ "\\u001b[31mred\\u001b[0m": 1, "k\\u0000k": 2, "\\u2764\\ufe0f": 3, "\\u{1f468}\\u200d\\u{1f469}": 4, "\\uff21\\uff22": 5, "\\u3000": 6 }]);
  console.table({ "\\u0e01\\u0e33": { x: "\\u0e01\\u0e31" }, "\\u{20000}": { x: "\\u{1f1e6}\\u{1f1fa}" } });
  return 1;
`);
run();
