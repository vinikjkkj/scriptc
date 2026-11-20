// A program that uses a regex and toLowerCase/toUpperCase (scr_regex.c) but no dynamic method call links and runs, like Node.
const words: string[] = ["Alpha", "bETA", "GaMmA"];
console.log(words.map((w) => w.toLowerCase()).join(","), words.map((w) => w.toUpperCase()).join(","));
console.log(/^[a-z]+$/i.test(words[1]!), "a-b-c".replace(/-/g, "+"), "x1y22z".split(/\d+/).join("|"), "Straße".toUpperCase(), "İ".toLowerCase().length);
