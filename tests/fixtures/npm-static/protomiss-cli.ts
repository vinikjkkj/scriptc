// npm-static pilot: a type table filled with `Class.prototype.<name>` where
// some names are methods and some are names the class never defines
// (mysql2's binary_row).
import protomiss from "protomiss";

console.log(protomiss.run());
