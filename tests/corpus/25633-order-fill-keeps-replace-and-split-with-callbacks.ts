const cold = process.env.COLD === "1";
const s = "a1b22c333d";
console.log(s.replace(/\d+/g, (d) => "<" + d.length + ">"), s.split(/\d+/).join("|"), cold ? s.replace(/(\w)(\d)/g, "$2$1") : s.toUpperCase());
