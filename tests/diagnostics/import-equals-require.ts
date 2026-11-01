// The require form of import= binds a builtin namespace. Its members lower
// (fs.readFileSync), but the namespace OBJECT as a first-class value has no
// compiled representation (sonnet queue item 3): fenced by name at the use.
import fs = require("fs");
console.log(fs);
