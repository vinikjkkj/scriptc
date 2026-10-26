// Function constructors with prototype methods, constructed through a namespace
// member of a sibling module (iconv-lite's bom-handling reduced to its shape).
const iconv = require("./lib/index.cjs")
const e1 = iconv.getEncoder("utf8", { addBOM: true })
console.log(e1.write("a"), e1.write("b"), e1.end())
const e2 = iconv.getEncoder("utf8", {})
console.log(e2.write("c"), e2.end())
const d1 = iconv.getDecoder("utf8", {})
console.log(d1.write(String.fromCharCode(0xFEFF) + "xy"), d1.write("z"), d1.end())
const d2 = iconv.getDecoder("utf8", { stripBOM: false })
console.log(d2.write(String.fromCharCode(0xFEFF) + "q"), d2.end())
const bom = require("./lib/bom-handling.cjs")
const direct = new bom.PrependBOM({ write: (s) => "W" + s, end: () => "F" }, {})
console.log(direct.write("x"), direct.write("y"), direct.end(), direct instanceof bom.PrependBOM)
