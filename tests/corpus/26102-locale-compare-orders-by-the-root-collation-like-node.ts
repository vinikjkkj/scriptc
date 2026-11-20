// String.prototype.localeCompare in the default locale is the CLDR root collation (ICU), not code-unit order.
const a: string = "a", b: string = "B";
console.log(a.localeCompare(b), b.localeCompare(a), a.localeCompare("a"), "a".localeCompare("A"), "A".localeCompare("a"));
console.log("ä".localeCompare("z"), "résumé".localeCompare("resume"), "resume".localeCompare("résumé"), "e".localeCompare("é"), "é".localeCompare("f"));
console.log("10".localeCompare("2"), "a b".localeCompare("ab"), "-".localeCompare("_"), "_".localeCompare("a"), "1".localeCompare("a"), "~".localeCompare("1"));
console.log("á".localeCompare("á"), "á".localeCompare("á"), "ẛ̣".localeCompare("ẛ̣"), "Å".localeCompare("Å"), "ǆ".localeCompare("dž"));
const xs: string[] = ["banana", "Apple", "cherry", "apple", "Banana", "éclair", "eclair", "Zed", "zed", "ab", "a b", "résumé", "resume", "ä", "z", "Z", "10", "2", "_x", "-x", "x", ""];
console.log(xs.slice().sort((p, q) => p.localeCompare(q)).join(","));
console.log("α".localeCompare("β"), "я".localeCompare("а"), "א".localeCompare("ב"), "ก".localeCompare("ข"), "ا".localeCompare("أ"), "あ".localeCompare("ア"), "ア".localeCompare("イ"));
console.log("가".localeCompare("각"), "한".localeCompare("힣"), "一".localeCompare("丁"), "丁".localeCompare("丂"), "㐀".localeCompare("一"), "日".localeCompare("本"));
console.log("😀".localeCompare("😁"), "😀".localeCompare("a"), "😀".localeCompare("1"), "\u{20000}".localeCompare("一"), "".localeCompare("\u{10ffff}"), "�".localeCompare("￿"));
console.log("ab".localeCompare("a­b"), "a​b".localeCompare("ab"), "l·l".localeCompare("ll"), "L·".localeCompare("L"), "เก".localeCompare("กเ"));
