// Dyn String methods through the dot and computed spellings, and members read off their any-typed results, answer like Node.
const s: any = JSON.parse('"Hello, World"');
console.log(s.isWellFormed(), s.toWellFormed(), s.toLocaleLowerCase(), s.toLocaleUpperCase(), s.normalize("NFD").length, s.codePointAt(1));
console.log(s.split(", ").join("|"), s.replace("World", "$&!"), s.replaceAll("l", "L"), s.search(/W/), s.match(/o/g).join());
const name = "toLocaleUpperCase";
console.log(s[name](), s["split"]("o").length);
