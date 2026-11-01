import path = require("path");

console.log(path.basename("/a/b/c.txt"));
console.log(path.join("x", "y", "..", "z.js"));
console.log(path.extname("file.tar.gz"));
console.log(path.sep === "/");
