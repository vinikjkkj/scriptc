// A class declared in a .d.ts (merged with an interface) and implemented by
// a compiled .js twin. The program imports it under an alias, writes its
// statics through the alias and through a const of it, and reads them back.
import Alias from "./lib.js";

Alias.level = 5;
Alias.tag = "t";
const viaConst = Alias;
viaConst.level = viaConst.level + 2;
viaConst.tag = viaConst.tag + "!";

const c = new Alias(1);
console.log(Alias.level, Alias.tag, viaConst.level, c.hi());
